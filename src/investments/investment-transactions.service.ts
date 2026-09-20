import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { assertCurrency } from '../common/currency';
import { FxService } from '../market-data/fx.service';
import { PricesService } from '../market-data/prices.service';
import { TrmService, trmRate } from '../market-data/trm.service';
import { User } from '../users/entities/user.entity';
import {
  INSTRUMENT_REQUIRED_TYPES,
  InvestmentTransactionType,
} from '../common/enums/investment-transaction-type.enum';
import { LedgerError } from './analytics/portfolio-ledger';
import { roundMoney, roundQuantity } from './analytics/money';
import { dedupeHash } from './dedupe';
import {
  CreateInvestmentTransactionInput,
  SetLotCostBasisInput,
  UpdateInvestmentTransactionInput,
} from './dto/investment-transaction.input';
import {
  InvestmentTransactionsFilterInput,
  MAX_TRANSACTIONS_LIMIT,
} from './dto/investments-filter.input';
import { InvestmentAccountsService } from './investment-accounts.service';
import { InvestmentLot } from './entities/investment-lot.entity';
import {
  FxRateSource,
  InvestmentTransaction,
} from './entities/investment-transaction.entity';
import { PositionsService } from './positions.service';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class InvestmentTransactionsService {
  constructor(
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    @InjectRepository(InvestmentLot)
    private readonly lotsRepository: Repository<InvestmentLot>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly accountsService: InvestmentAccountsService,
    private readonly positionsService: PositionsService,
    private readonly pricesService: PricesService,
    private readonly fxService: FxService,
    private readonly trmService: TrmService,
    private readonly dataSource: DataSource,
  ) {}

  // --- lectura ---

  findAll(
    userId: string,
    filter?: InvestmentTransactionsFilterInput,
  ): Promise<InvestmentTransaction[]> {
    const limit = this.clampLimit(filter?.limit);
    return this.transactionsRepository.find({
      where: this.buildWhere(userId, filter),
      relations: { account: true, instrument: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
      take: limit,
      skip: Math.max(0, filter?.offset ?? 0),
    });
  }

  count(
    userId: string,
    filter?: InvestmentTransactionsFilterInput,
  ): Promise<number> {
    return this.transactionsRepository.count({
      where: this.buildWhere(userId, filter),
    });
  }

  async findOne(id: string, userId: string): Promise<InvestmentTransaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id, userId },
      relations: { account: true, instrument: true },
    });
    if (!transaction) {
      throw new NotFoundException(`Operación de inversión ${id} no encontrada`);
    }
    return transaction;
  }

  private clampLimit(limit?: number): number {
    const value = limit ?? 100;
    if (value > MAX_TRANSACTIONS_LIMIT) {
      throw new BadRequestException(
        `El límite máximo es ${MAX_TRANSACTIONS_LIMIT}`,
      );
    }
    return Math.max(1, value);
  }

  private buildWhere(
    userId: string,
    filter?: InvestmentTransactionsFilterInput,
  ): FindOptionsWhere<InvestmentTransaction> {
    const where: FindOptionsWhere<InvestmentTransaction> = { userId };
    if (filter?.from && filter?.to) {
      where.occurredOn = Between(filter.from, filter.to);
    } else if (filter?.from) {
      where.occurredOn = MoreThanOrEqual(filter.from);
    } else if (filter?.to) {
      where.occurredOn = LessThanOrEqual(filter.to);
    }
    if (filter?.accountId) {
      where.accountId = filter.accountId;
    }
    if (filter?.instrumentId) {
      where.instrumentId = filter.instrumentId;
    }
    if (filter?.types?.length) {
      where.type = In(filter.types);
    }
    return where;
  }

  private async baseCurrency(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    return user?.baseCurrency ?? 'USD';
  }

  // --- escritura ---

  async create(
    userId: string,
    input: CreateInvestmentTransactionInput,
  ): Promise<InvestmentTransaction> {
    const normalized = await this.normalize(userId, input);
    await this.accountsService.assertOwned(input.accountId, userId);
    await this.accountsService.assertOwned(input.counterpartyAccountId, userId);

    const id = await this.runWrite(
      userId,
      [input.accountId],
      async (manager) => {
        const saved = await manager.save(
          manager.create(InvestmentTransaction, normalized),
        );
        return saved.id;
      },
    );

    // Una posición nueva necesita histórico de precios para poder valorarse y
    // para que la serie del patrimonio no arranque vacía. NO bloquea esta
    // mutación: si hay holgura de presupuesto se trae al momento, si no queda
    // marcado y lo recoge el job nocturno.
    if (input.instrumentId) {
      await this.pricesService.requestBackfill(
        input.instrumentId,
        input.occurredOn,
      );
    }
    return this.findOne(id, userId);
  }

  async update(
    userId: string,
    input: UpdateInvestmentTransactionInput,
  ): Promise<InvestmentTransaction> {
    const existing = await this.findOne(input.id, userId);
    const merged = await this.normalize(userId, {
      accountId: existing.accountId,
      type: existing.type,
      instrumentId: existing.instrumentId ?? undefined,
      occurredOn: input.occurredOn ?? existing.occurredOn,
      occurredAt: input.occurredAt ?? existing.occurredAt ?? undefined,
      quantity: input.quantity ?? existing.quantity ?? undefined,
      price: input.price ?? existing.price ?? undefined,
      amount: input.amount ?? existing.amount,
      fee: input.fee ?? existing.fee,
      tax: input.tax ?? existing.tax,
      currency: existing.currency,
      fxRate: input.fxRate ?? existing.fxRate,
      settlementCurrency: existing.settlementCurrency ?? undefined,
      settlementAmount: existing.settlementAmount ?? undefined,
      splitRatioNumerator:
        input.splitRatioNumerator ?? existing.splitRatioNumerator ?? undefined,
      splitRatioDenominator:
        input.splitRatioDenominator ??
        existing.splitRatioDenominator ??
        undefined,
      counterpartyAccountId: existing.counterpartyAccountId ?? undefined,
      notes: input.notes ?? existing.notes ?? undefined,
      occurrenceIndex: existing.occurrenceIndex,
    });

    // cualquier edición es retroactiva por definición: el ámbito se reconstruye
    // entero, nunca de forma incremental
    await this.runWrite(userId, [existing.accountId], async (manager) => {
      await manager.update(InvestmentTransaction, { id: input.id }, merged);
    });
    return this.findOne(input.id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const existing = await this.findOne(id, userId);
    await this.runWrite(userId, [existing.accountId], async (manager) => {
      await manager.delete(InvestmentTransaction, { id, userId });
    });
    return true;
  }

  // Corrige la base de costo de un lote estimado (típico de un TRANSFER_IN que
  // el bróker entregó sin precio). Dispara reconstrucción porque el P&L
  // realizado de cualquier venta posterior cambia.
  async setLotCostBasis(
    userId: string,
    input: SetLotCostBasisInput,
  ): Promise<InvestmentLot> {
    const lot = await this.lotsRepository.findOne({
      where: { id: input.lotId, userId },
    });
    if (!lot) {
      throw new NotFoundException(`Lote ${input.lotId} no encontrado`);
    }
    if (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0) {
      throw new BadRequestException('El costo unitario no puede ser negativo');
    }
    if (!lot.openTransactionId) {
      throw new BadRequestException(
        'El lote no tiene operación de origen; corrige la operación en su lugar',
      );
    }

    await this.runWrite(userId, [lot.accountId], async (manager) => {
      // la base vive en la operación, no en el lote: el lote es derivado y la
      // reconstrucción lo recrearía pisando la corrección
      await manager.update(
        InvestmentTransaction,
        { id: lot.openTransactionId!, userId },
        { price: input.costPerUnit },
      );
    });

    const refreshed = await this.lotsRepository.findOne({
      where: {
        userId,
        accountId: lot.accountId,
        instrumentId: lot.instrumentId,
        openTransactionId: lot.openTransactionId,
      },
    });
    return refreshed ?? lot;
  }

  // Re-resuelve la tasa de cambio de las operaciones que quedaron en 1 por no
  // haber caché de tasas cuando se escribieron.
  //
  // Hace falta de verdad: una operación en USD guardada con tasa 1 mientras la
  // moneda base es COP deja el flujo externo sin convertir y la cartera sí
  // convertida, y eso dispara el TWR. Solo toca las filas marcadas como
  // ASSUMED_ONE: una tasa que el usuario escribió a mano (MANUAL) se respeta.
  async resolveMissingFxRates(userId: string): Promise<number> {
    const baseCurrency = await this.baseCurrency(userId);
    const pending = await this.transactionsRepository.find({
      where: {
        userId,
        fxRateSource: FxRateSource.ASSUMED_ONE,
        currency: Not(baseCurrency),
      },
      order: { occurredOn: 'ASC' },
    });
    if (pending.length === 0) {
      return 0;
    }

    let updated = 0;
    const accountIds = new Set<string>();
    for (const transaction of pending) {
      const rate = await this.fxService.rateForWrite(
        transaction.currency,
        baseCurrency,
        transaction.occurredOn,
      );
      if (rate === 1) {
        continue;
      }
      await this.transactionsRepository.update(
        { id: transaction.id },
        { fxRate: rate, fxRateSource: FxRateSource.TWELVE_DATA },
      );
      accountIds.add(transaction.accountId);
      updated += 1;
    }

    if (accountIds.size > 0) {
      await this.positionsService.rebuild(userId, [...accountIds]);
    }
    return updated;
  }

  // Ejecuta la escritura y la reconstrucción en UNA transacción, para que el
  // libro y sus derivados no puedan quedar descuadrados.
  private async runWrite<T>(
    userId: string,
    accountIds: string[],
    write: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const result = await write(manager);
        await this.positionsService.rebuild(userId, accountIds, manager);
        return result;
      });
    } catch (error) {
      if (error instanceof LedgerError) {
        throw new BadRequestException(error.message);
      }
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code ===
          UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          'La operación ya está registrada. Si de verdad se repite el mismo día, ' +
            'usa occurrenceIndex para distinguirla',
        );
      }
      throw error;
    }
  }

  // Normaliza y valida según el tipo. El @Check de la base es la última red;
  // esto da el mensaje legible antes de llegar allí.
  private async normalize(
    userId: string,
    input: CreateInvestmentTransactionInput,
  ): Promise<Partial<InvestmentTransaction>> {
    const type = input.type;
    const currency = assertCurrency(input.currency ?? 'USD');
    const quantity =
      input.quantity != null ? roundQuantity(input.quantity) : null;
    const price = input.price ?? null;

    if (INSTRUMENT_REQUIRED_TYPES.includes(type) && !input.instrumentId) {
      throw new BadRequestException(
        `La operación ${type} necesita un instrumento`,
      );
    }
    if (
      [
        InvestmentTransactionType.BUY,
        InvestmentTransactionType.SELL,
        InvestmentTransactionType.TRANSFER_IN,
        InvestmentTransactionType.TRANSFER_OUT,
      ].includes(type) &&
      (quantity == null || quantity <= 0)
    ) {
      throw new BadRequestException(
        `La operación ${type} necesita una cantidad mayor que 0`,
      );
    }

    // en compras y ventas el importe bruto se deduce de cantidad x precio
    let amount = input.amount ?? 0;
    if (
      !amount &&
      quantity != null &&
      price != null &&
      (type === InvestmentTransactionType.BUY ||
        type === InvestmentTransactionType.SELL)
    ) {
      amount = quantity * price;
    }
    amount = roundMoney(amount);

    const needsAmount = [
      InvestmentTransactionType.BUY,
      InvestmentTransactionType.SELL,
      InvestmentTransactionType.DIVIDEND,
      InvestmentTransactionType.INTEREST,
      InvestmentTransactionType.DEPOSIT,
      InvestmentTransactionType.WITHDRAWAL,
      InvestmentTransactionType.FEE,
      InvestmentTransactionType.TAX,
      InvestmentTransactionType.CURRENCY_EXCHANGE,
    ].includes(type);
    if (needsAmount && amount <= 0) {
      throw new BadRequestException(
        `La operación ${type} necesita un importe mayor que 0`,
      );
    }

    const fee = roundMoney(input.fee ?? 0);
    const tax = roundMoney(input.tax ?? 0);
    if (fee < 0 || tax < 0) {
      throw new BadRequestException(
        'La comisión y el impuesto no pueden ser negativos',
      );
    }

    if (type === InvestmentTransactionType.SPLIT) {
      const numerator = input.splitRatioNumerator ?? 0;
      const denominator = input.splitRatioDenominator ?? 0;
      if (numerator <= 0 || denominator <= 0) {
        throw new BadRequestException(
          'El split necesita una proporción válida (ej. 2 y 1 para un 2:1)',
        );
      }
    }

    let settlementCurrency: string | null = null;
    if (type === InvestmentTransactionType.CURRENCY_EXCHANGE) {
      if (!input.settlementCurrency || input.settlementAmount == null) {
        throw new BadRequestException(
          'El cambio de divisa necesita moneda e importe de liquidación',
        );
      }
      settlementCurrency = assertCurrency(input.settlementCurrency);
      if (settlementCurrency === currency) {
        throw new BadRequestException(
          'Las monedas de origen y liquidación son la misma',
        );
      }
      if (input.settlementAmount <= 0) {
        throw new BadRequestException(
          'El importe de liquidación debe ser mayor que 0',
        );
      }
    }

    if (
      type === InvestmentTransactionType.TRANSFER_OUT &&
      input.counterpartyAccountId === input.accountId
    ) {
      throw new BadRequestException(
        'La cuenta origen y la de destino son la misma',
      );
    }

    // La tasa hacia la moneda base se CONGELA aquí, en el momento de escribir.
    //
    // Si el usuario no la da, se resuelve contra el caché de tasas. Dejarla en
    // 1 por defecto era un bug de verdad: los flujos externos quedaban sin
    // convertir mientras la cartera sí se valoraba convertida, y el TWR salía
    // disparado por el factor de la divisa.
    const baseCurrency = await this.baseCurrency(userId);
    let fxRate: number;
    let fxRateSource: FxRateSource;
    if (input.fxRate !== undefined && input.fxRate !== null) {
      fxRate = input.fxRate;
      fxRateSource =
        currency === baseCurrency
          ? FxRateSource.ASSUMED_ONE
          : FxRateSource.MANUAL;
    } else if (currency === baseCurrency) {
      fxRate = 1;
      fxRateSource = FxRateSource.ASSUMED_ONE;
    } else if (
      (currency === 'USD' && baseCurrency === 'COP') ||
      (currency === 'COP' && baseCurrency === 'USD')
    ) {
      const trm = (await this.trmService.latest()).value;
      fxRate = trmRate(currency, baseCurrency, trm);
      fxRateSource = FxRateSource.MANUAL;
    } else {
      fxRate = await this.fxService.rateForWrite(
        currency,
        baseCurrency,
        input.occurredOn,
      );
      fxRateSource =
        fxRate === 1 ? FxRateSource.ASSUMED_ONE : FxRateSource.TWELVE_DATA;
    }
    if (fxRate <= 0) {
      throw new BadRequestException('La tasa de cambio debe ser mayor que 0');
    }

    const occurrenceIndex = input.occurrenceIndex ?? 0;

    return {
      userId,
      accountId: input.accountId,
      type,
      instrumentId: input.instrumentId ?? null,
      occurredOn: input.occurredOn,
      occurredAt: input.occurredAt ?? null,
      quantity,
      price,
      amount,
      fee,
      tax,
      currency,
      fxRate,
      fxRateSource,
      settlementCurrency,
      settlementAmount: input.settlementAmount ?? null,
      splitRatioNumerator: input.splitRatioNumerator ?? null,
      splitRatioDenominator: input.splitRatioDenominator ?? null,
      counterpartyAccountId: input.counterpartyAccountId ?? null,
      notes: input.notes ?? null,
      occurrenceIndex,
      dedupeHash: dedupeHash({
        userId,
        accountId: input.accountId,
        type,
        occurredOn: input.occurredOn,
        instrumentId: input.instrumentId ?? null,
        quantity,
        amount,
        currency,
        occurrenceIndex,
      }),
    };
  }
}

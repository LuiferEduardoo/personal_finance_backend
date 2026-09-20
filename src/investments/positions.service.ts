import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { LedgerEvent, LedgerState, replay } from './analytics/portfolio-ledger';
import { InvestmentAccount } from './entities/investment-account.entity';
import { InvestmentCashBalance } from './entities/investment-cash-balance.entity';
import { InvestmentLot } from './entities/investment-lot.entity';
import { InvestmentPosition } from './entities/investment-position.entity';
import { InvestmentRealization } from './entities/investment-realization.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';

// Reconstruye lotes, realizaciones, posiciones y efectivo a partir del libro
// de operaciones.
//
// El ÁMBITO de reconstrucción es el conjunto de CUENTAS afectadas, no el par
// (cuenta, instrumento): una TRANSFER_OUT con destino mueve lotes entre
// cuentas, así que el ámbito se expande a la contraparte. Una cartera personal
// tiene pocas cuentas y unos miles de filas, así que reproducir el histórico
// completo de una cuenta cuesta milisegundos.
@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);

  constructor(
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    @InjectRepository(InvestmentPosition)
    private readonly positionsRepository: Repository<InvestmentPosition>,
    @InjectRepository(InvestmentAccount)
    private readonly accountsRepository: Repository<InvestmentAccount>,
    private readonly dataSource: DataSource,
  ) {}

  findPositions(
    userId: string,
    where: { accountId?: string; instrumentId?: string } = {},
  ): Promise<InvestmentPosition[]> {
    return this.positionsRepository.find({
      where: { userId, ...where },
      relations: { account: true, instrument: true },
      order: { updatedAt: 'DESC' },
    });
  }

  // Punto de entrada único: tras cualquier escritura en el libro se llama
  // aquí con las cuentas tocadas. Siempre dentro de la transacción de quien
  // llama, para que el libro y sus derivados no puedan quedar descuadrados.
  async rebuild(
    userId: string,
    accountIds: string[],
    manager?: EntityManager,
  ): Promise<void> {
    if (accountIds.length === 0) {
      return;
    }
    if (manager) {
      await this.rebuildWithin(userId, accountIds, manager);
      return;
    }
    await this.dataSource.transaction((tx) =>
      this.rebuildWithin(userId, accountIds, tx),
    );
  }

  // Reconstruye TODAS las cuentas del usuario. Es la válvula manual, el
  // equivalente de recalculateAccountBalance en payment_methods.
  async rebuildAll(userId: string, accountId?: string): Promise<number> {
    const accounts = await this.accountsRepository.find({
      where: { userId, ...(accountId ? { id: accountId } : {}) },
      select: { id: true },
    });
    const ids = accounts.map((account) => account.id);
    if (ids.length === 0) {
      return 0;
    }
    await this.rebuild(userId, ids);
    return ids.length;
  }

  private async rebuildWithin(
    userId: string,
    accountIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    const scope = await this.expandScope(userId, accountIds, manager);
    const events = await this.loadEvents(userId, scope, manager);
    const state = replay(events);
    await this.persist(userId, scope, state, manager);
    this.logger.debug(
      `Cartera reconstruida: ${scope.length} cuenta(s), ${events.length} operación(es)`,
    );
  }

  // Una transferencia con destino conocido mueve lotes a otra cuenta, así que
  // esa cuenta entra al ámbito o quedaría con lotes huérfanos.
  private async expandScope(
    userId: string,
    accountIds: string[],
    manager: EntityManager,
  ): Promise<string[]> {
    const scope = new Set(accountIds);
    const repository = manager.getRepository(InvestmentTransaction);

    // dos direcciones: lo que sale de las cuentas del ámbito y lo que entra
    // a ellas desde fuera
    const outgoing = await repository.find({
      where: {
        userId,
        accountId: In([...scope]),
        type: InvestmentTransactionType.TRANSFER_OUT,
      },
      select: { counterpartyAccountId: true },
    });
    const incoming = await repository.find({
      where: {
        userId,
        counterpartyAccountId: In([...scope]),
        type: InvestmentTransactionType.TRANSFER_OUT,
      },
      select: { accountId: true },
    });

    for (const row of outgoing) {
      if (row.counterpartyAccountId) {
        scope.add(row.counterpartyAccountId);
      }
    }
    for (const row of incoming) {
      scope.add(row.accountId);
    }
    return [...scope];
  }

  private async loadEvents(
    userId: string,
    accountIds: string[],
    manager: EntityManager,
  ): Promise<LedgerEvent[]> {
    const rows = await manager.getRepository(InvestmentTransaction).find({
      where: { userId, accountId: In(accountIds) },
      order: { occurredOn: 'ASC', createdAt: 'ASC' },
    });

    const hints = await this.marketPriceHints(rows, manager);

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      type: row.type,
      instrumentId: row.instrumentId,
      occurredOn: row.occurredOn,
      occurredAt: row.occurredAt,
      quantity: row.quantity,
      price: row.price,
      amount: row.amount,
      fee: row.fee,
      tax: row.tax,
      currency: row.currency,
      fxRate: row.fxRate,
      settlementCurrency: row.settlementCurrency,
      settlementAmount: row.settlementAmount,
      splitRatioNumerator: row.splitRatioNumerator,
      splitRatioDenominator: row.splitRatioDenominator,
      counterpartyAccountId: row.counterpartyAccountId,
      marketPriceHint: hints.get(row.id) ?? null,
    }));
  }

  // Precio de mercado del día para resolver la base de una TRANSFER_IN que no
  // trae precio. El reductor es puro y no hace E/S: la pista se le inyecta.
  private async marketPriceHints(
    rows: InvestmentTransaction[],
    manager: EntityManager,
  ): Promise<Map<string, number>> {
    const hints = new Map<string, number>();
    const needing = rows.filter(
      (row) =>
        row.type === InvestmentTransactionType.TRANSFER_IN &&
        !row.price &&
        row.instrumentId,
    );
    if (needing.length === 0) {
      return hints;
    }

    const results: { id: string; close: string | null }[] = await manager.query(
      `
        SELECT t."id", (
          SELECT p."close"
          FROM "instrument_prices" p
          WHERE p."instrument_id" = t."instrument_id"
            AND p."price_on" <= t."occurred_on"
          ORDER BY p."price_on" DESC
          LIMIT 1
        ) AS "close"
        FROM "investment_transactions" t
        WHERE t."id" = ANY($1::uuid[])
      `,
      [needing.map((row) => row.id)],
    );

    for (const row of results) {
      if (row.close !== null) {
        hints.set(row.id, Number(row.close));
      }
    }
    return hints;
  }

  private async persist(
    userId: string,
    accountIds: string[],
    state: LedgerState,
    manager: EntityManager,
  ): Promise<void> {
    // borrar y reescribir: los derivados no tienen vida propia, siempre son
    // una función del libro
    await manager.delete(InvestmentRealization, { accountId: In(accountIds) });
    await manager.delete(InvestmentLot, { accountId: In(accountIds) });
    await manager.delete(InvestmentPosition, { accountId: In(accountIds) });
    await manager.delete(InvestmentCashBalance, { accountId: In(accountIds) });

    if (state.lots.length > 0) {
      await manager.insert(
        InvestmentLot,
        state.lots.map((lot) => ({
          id: lot.id,
          userId,
          accountId: lot.accountId,
          instrumentId: lot.instrumentId,
          openTransactionId: lot.openTransactionId,
          openedOn: lot.openedOn,
          quantityOriginal: lot.quantityOriginal,
          quantityOpen: lot.quantityOpen,
          costPerUnit: lot.costPerUnit,
          currency: lot.currency,
          costPerUnitBase: lot.costPerUnitBase,
          costBasisIsEstimated: lot.costBasisIsEstimated,
          closedOn: lot.closedOn,
        })),
      );
    }

    if (state.realizations.length > 0) {
      await manager.insert(
        InvestmentRealization,
        state.realizations.map((realization) => ({
          id: realization.id,
          userId,
          accountId: realization.accountId,
          instrumentId: realization.instrumentId,
          sellTransactionId: realization.sellTransactionId,
          lotId: realization.lotId,
          quantity: realization.quantity,
          proceedsPerUnit: realization.proceedsPerUnit,
          costPerUnit: realization.costPerUnit,
          realizedPnl: realization.realizedPnl,
          realizedPnlBase: realization.realizedPnlBase,
          currency: realization.currency,
          realizedOn: realization.realizedOn,
          disposition: realization.disposition,
          costBasisIsEstimated: realization.costBasisIsEstimated,
        })),
      );
    }

    if (state.positions.length > 0) {
      await manager.insert(
        InvestmentPosition,
        state.positions.map((position) => ({
          userId,
          accountId: position.accountId,
          instrumentId: position.instrumentId,
          quantity: position.quantity,
          averageCost: position.averageCost,
          costBasis: position.costBasis,
          costBasisBase: position.costBasisBase,
          currency: position.currency,
          realizedPnlToDateBase: position.realizedPnlToDateBase,
          costBasisIsEstimated: position.costBasisIsEstimated,
          lastTransactionOn: position.lastTransactionOn,
        })),
      );
    }

    if (state.cash.length > 0) {
      await manager.insert(
        InvestmentCashBalance,
        state.cash.map((balance) => ({
          accountId: balance.accountId,
          currency: balance.currency,
          amount: balance.amount,
        })),
      );
    }
  }
}

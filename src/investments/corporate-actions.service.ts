import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toDateString } from '../common/date';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { CorporateActionsService as MarketCorporateActionsService } from '../market-data/corporate-actions.service';
import { CorporateActionType } from '../market-data/entities/instrument-corporate-action.entity';
import { roundMoney } from './analytics/money';
import { PendingCorporateAction } from './dto/corporate-action.type';
import { InvestmentTransaction } from './entities/investment-transaction.entity';
import { InvestmentTransactionsService } from './investment-transactions.service';

// margen para considerar que una operación del libro "ya cubre" la acción
// corporativa: los brókers liquidan con días de desfase
const MATCH_WINDOW_DAYS = 5;

// ---------------------------------------------------------------------------
// Las acciones corporativas se SUGIEREN, nunca se insertan solas.
//
// Esta es la decisión de corrección más importante de esta parte. Insertar
// automáticamente duplicaría todo lo que la sincronización con el bróker ya
// trae: el bróker YA reporta el dividendo que pagó y el split que aplicó. Lo
// que aporta este proveedor es detectar lo que FALTA, no rellenarlo por su
// cuenta.
// ---------------------------------------------------------------------------
@Injectable()
export class InvestmentCorporateActionsService {
  private readonly logger = new Logger(InvestmentCorporateActionsService.name);

  constructor(
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    private readonly marketActions: MarketCorporateActionsService,
    private readonly transactionsService: InvestmentTransactionsService,
  ) {}

  async pending(userId: string): Promise<PendingCorporateAction[]> {
    // instrumentos que el usuario ha tenido alguna vez, con su primera compra
    const holdings: {
      instrument_id: string;
      first_on: Date | string;
      symbol: string;
      name: string;
    }[] = await this.transactionsRepository.query(
      `
        SELECT t."instrument_id", MIN(t."occurred_on") AS first_on,
               i."symbol", i."name"
        FROM "investment_transactions" t
        JOIN "instruments" i ON i."id" = t."instrument_id"
        WHERE t."user_id" = $1 AND t."instrument_id" IS NOT NULL
        GROUP BY t."instrument_id", i."symbol", i."name"
      `,
      [userId],
    );
    if (holdings.length === 0) {
      return [];
    }

    const firstBuy = new Map<string, string>();
    const names = new Map<string, { symbol: string; name: string }>();
    for (const row of holdings) {
      firstBuy.set(row.instrument_id, toDateString(row.first_on)!);
      names.set(row.instrument_id, { symbol: row.symbol, name: row.name });
    }

    const actions = await this.marketActions.findForInstruments([
      ...firstBuy.keys(),
    ]);

    const pending: PendingCorporateAction[] = [];
    for (const action of actions) {
      const since = firstBuy.get(action.instrumentId);
      // una acción anterior a tu primera compra no te afecta
      if (!since || action.exDate < since) {
        continue;
      }
      if (await this.alreadyRecorded(userId, action.instrumentId, action)) {
        continue;
      }

      const held = await this.quantityOn(
        userId,
        action.instrumentId,
        action.exDate,
      );
      // si no tenías títulos ese día, no te afectaba
      if (held.quantity <= 0) {
        continue;
      }

      const info = names.get(action.instrumentId)!;
      pending.push({
        id: action.id,
        type: action.type,
        instrumentId: action.instrumentId,
        symbol: info.symbol,
        instrumentName: info.name,
        exDate: action.exDate,
        amountPerShare: action.amount,
        quantityHeld: held.quantity,
        estimatedAmount:
          action.type === CorporateActionType.DIVIDEND && action.amount
            ? roundMoney(held.quantity * action.amount)
            : null,
        ratioNumerator: action.ratioNumerator,
        ratioDenominator: action.ratioDenominator,
        currency: action.currency,
        description: action.description,
        accountIds: held.accountIds,
      });
    }

    return pending.sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  }

  // Crea la operación que corresponde a una acción corporativa, cuando el
  // usuario confirma que le falta. Nunca se llama sola.
  async apply(
    userId: string,
    actionId: string,
    accountId: string,
  ): Promise<InvestmentTransaction> {
    const action = await this.marketActions.findOne(actionId);
    if (!action) {
      throw new BadRequestException(
        `Acción corporativa ${actionId} no encontrada`,
      );
    }

    const held = await this.quantityOn(
      userId,
      action.instrumentId,
      action.exDate,
    );
    if (held.quantity <= 0) {
      throw new BadRequestException(
        `No tenías títulos de ese instrumento el ${action.exDate}`,
      );
    }

    if (action.type === CorporateActionType.SPLIT) {
      return this.transactionsService.create(userId, {
        accountId,
        instrumentId: action.instrumentId,
        type: InvestmentTransactionType.SPLIT,
        occurredOn: action.exDate,
        splitRatioNumerator: action.ratioNumerator ?? 1,
        splitRatioDenominator: action.ratioDenominator ?? 1,
        currency: action.currency ?? 'USD',
        notes: action.description ?? 'Split aplicado desde acción corporativa',
      });
    }

    if (!action.amount) {
      throw new BadRequestException(
        'La acción corporativa no trae importe por título',
      );
    }
    return this.transactionsService.create(userId, {
      accountId,
      instrumentId: action.instrumentId,
      type: InvestmentTransactionType.DIVIDEND,
      occurredOn: action.exDate,
      amount: roundMoney(held.quantity * action.amount),
      currency: action.currency ?? 'USD',
      notes: `Dividendo de ${action.amount} por título, aplicado desde acción corporativa`,
    });
  }

  // ¿Ya hay una operación del libro que cubra esta acción?
  private async alreadyRecorded(
    userId: string,
    instrumentId: string,
    action: { type: CorporateActionType; exDate: string },
  ): Promise<boolean> {
    const type =
      action.type === CorporateActionType.SPLIT
        ? InvestmentTransactionType.SPLIT
        : InvestmentTransactionType.DIVIDEND;
    const [row] = await this.transactionsRepository.query(
      `
        SELECT 1
        FROM "investment_transactions"
        WHERE "user_id" = $1 AND "instrument_id" = $2 AND "type" = $3
          AND "occurred_on" BETWEEN $4::date - $5::int AND $4::date + $5::int
        LIMIT 1
      `,
      [userId, instrumentId, type, action.exDate, MATCH_WINDOW_DAYS],
    );
    return Boolean(row);
  }

  // Títulos que el usuario tenía en una fecha, y en qué cuentas.
  private async quantityOn(
    userId: string,
    instrumentId: string,
    date: string,
  ): Promise<{ quantity: number; accountIds: string[] }> {
    const rows: { account_id: string; quantity: string }[] =
      await this.transactionsRepository.query(
        `
          SELECT "account_id",
                 SUM(
                   CASE "type"
                     WHEN 'buy' THEN "quantity"
                     WHEN 'transfer_in' THEN "quantity"
                     WHEN 'sell' THEN -"quantity"
                     WHEN 'transfer_out' THEN -"quantity"
                     ELSE 0
                   END
                 ) AS quantity
          FROM "investment_transactions"
          WHERE "user_id" = $1 AND "instrument_id" = $2 AND "occurred_on" < $3::date
          GROUP BY "account_id"
        `,
        [userId, instrumentId, date],
      );

    const accountIds: string[] = [];
    let quantity = 0;
    for (const row of rows) {
      const value = Number(row.quantity);
      if (value > 0) {
        quantity += value;
        accountIds.push(row.account_id);
      }
    }
    return { quantity, accountIds };
  }
}

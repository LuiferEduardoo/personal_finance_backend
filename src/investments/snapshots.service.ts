import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toDateString } from '../common/date';
import { FxService } from '../market-data/fx.service';
import { shiftDays } from '../market-data/prices.service';
import { User } from '../users/entities/user.entity';
import { addMoney, roundMoney } from './analytics/money';
import {
  LedgerCheckpoint,
  LedgerEvent,
  replayDaily,
} from './analytics/portfolio-ledger';
import { TWR_BASE_INDEX, chainLink, DayPoint } from './analytics/twr';
import { InvestmentAccount } from './entities/investment-account.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';

const today = (): string => new Date().toISOString().substring(0, 10);

export interface SnapshotReport {
  users: number;
  days: number;
  estimatedDays: number;
}

interface PriceCell {
  close: number;
  priceOn: string;
}

// Construye la serie diaria de la cartera: valor, flujos y factor TWR por día.
//
// El factor diario del TWR DEBE persistirse: encadenar no se puede rederivar
// solo desde el estado final. Con twr_index guardado, cualquier consulta de
// rentabilidad entre dos fechas son dos lecturas y una división.
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);
  private readonly activeBuilds = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotsRepository: Repository<PortfolioSnapshot>,
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    @InjectRepository(InvestmentAccount)
    private readonly accountsRepository: Repository<InvestmentAccount>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly fxService: FxService,
  ) {}

  // Entrada del job nocturno y de la mutación manual, con el mismo
  // `userId?` opcional que usa RecurringExpensesService.runDue.
  async buildSnapshots(
    asOf: string = today(),
    userId?: string,
  ): Promise<SnapshotReport> {
    const report: SnapshotReport = { users: 0, days: 0, estimatedDays: 0 };
    const userIds = userId ? [userId] : await this.usersWithTransactions();

    for (const id of userIds) {
      try {
        const built = await this.buildForUser(id, asOf);
        report.users += 1;
        report.days += built.days;
        report.estimatedDays += built.estimatedDays;
      } catch (error) {
        this.logger.error(
          `No se pudieron construir snapshots de ${id}: ${(error as Error).message}`,
        );
        if (userId) {
          throw error;
        }
      }
    }
    return report;
  }

  async ensureCurrent(userId: string): Promise<void> {
    if (!(await this.isStale(userId))) return;

    const active = this.activeBuilds.get(userId);
    if (active) return active;

    const build = this.buildSnapshots(today(), userId)
      .then(() => undefined)
      .finally(() => this.activeBuilds.delete(userId));
    this.activeBuilds.set(userId, build);
    return build;
  }

  // Reconstruye TODA la serie del usuario. Es idempotente: borra y reescribe
  // desde la primera operación, así que una importación retroactiva se arregla
  // sola sin lógica de parcheo.
  private async buildForUser(
    userId: string,
    asOf: string,
  ): Promise<{ days: number; estimatedDays: number }> {
    const events = await this.loadEvents(userId);
    if (events.length === 0) {
      await this.snapshotsRepository.delete({ userId });
      return { days: 0, estimatedDays: 0 };
    }

    const baseCurrency = await this.baseCurrency(userId);
    const { checkpoints } = replayDaily(events);
    const firstDate = checkpoints[0].date;
    if (firstDate > asOf) {
      return { days: 0, estimatedDays: 0 };
    }

    const instrumentIds = [
      ...new Set(
        checkpoints.flatMap((checkpoint) =>
          checkpoint.positions.map((position) => position.instrumentId),
        ),
      ),
    ];
    const prices = await this.priceGrid(instrumentIds, asOf);
    const currencies = await this.instrumentCurrencies(instrumentIds);
    const fx = await this.fxGrid(
      baseCurrency,
      [
        ...new Set([
          ...currencies.values(),
          ...this.cashCurrencies(checkpoints),
        ]),
      ],
      asOf,
    );

    const points: DayPoint[] = [];
    const rows: Partial<PortfolioSnapshot>[] = [];
    let checkpointIndex = 0;
    let current: LedgerCheckpoint = checkpoints[0];
    let estimatedDays = 0;

    for (let date = firstDate; date <= asOf; date = shiftDays(date, 1)) {
      // avanza al último checkpoint cuya fecha ya pasó
      while (
        checkpointIndex + 1 < checkpoints.length &&
        checkpoints[checkpointIndex + 1].date <= date
      ) {
        checkpointIndex += 1;
        current = checkpoints[checkpointIndex];
      }
      const activeToday = current.date === date;

      let marketValue = 0;
      let costBasis = 0;
      let missingPrices = 0;
      let estimated = false;

      for (const position of current.positions) {
        if (position.quantity === 0) {
          continue;
        }
        const rate = this.rateFor(
          fx,
          currencies.get(position.instrumentId),
          date,
          baseCurrency,
        );
        costBasis = addMoney(costBasis, position.costBasisBase);
        const price = this.priceFor(prices, position.instrumentId, date);
        if (!price) {
          // sin precio NO se valora en 0: se excluye y se cuenta
          missingPrices += 1;
          continue;
        }
        if (price.priceOn !== date) {
          estimated = true;
        }
        marketValue = addMoney(
          marketValue,
          position.quantity * price.close * rate.value,
        );
        estimated = estimated || rate.estimated;
      }

      // El saldo ya trae su valor en base, acumulado movimiento a movimiento
      // con la tasa congelada de cada uno. No se revalora con la tasa del día:
      // eso convertía la diferencia de cambio en efectivo inventado.
      let cash = 0;
      for (const balance of current.cash) {
        cash = addMoney(cash, balance.amountBase);
      }

      const netFlow = activeToday ? current.netFlowBase : 0;
      points.push({
        date,
        endValue: roundMoney(marketValue + cash),
        externalFlow: netFlow,
      });
      rows.push({
        userId,
        accountId: null,
        baseCurrency,
        snapshotOn: date,
        marketValueBase: marketValue,
        cashBase: cash,
        costBasisBase: costBasis,
        contributionsToDateBase: roundMoney(
          current.contributionsBase - current.withdrawalsBase,
        ),
        netFlowBase: netFlow,
        unrealizedPnlBase: roundMoney(marketValue - costBasis),
        realizedPnlToDateBase: current.realizedToDateBase,
        dividendsToDateBase: current.dividendsToDateBase,
        isEstimated: estimated,
        missingPriceCount: missingPrices,
      });
      if (estimated) {
        estimatedDays += 1;
      }
    }

    const twr = chainLink(points);
    for (let i = 0; i < rows.length; i += 1) {
      rows[i].twrFactor = twr.days[i].factor;
      rows[i].twrIndex = twr.days[i].index;
    }

    await this.snapshotsRepository.manager.transaction(async (manager) => {
      await manager.delete(PortfolioSnapshot, { userId });
      // en trozos, para no armar un INSERT gigante en carteras largas
      for (let i = 0; i < rows.length; i += 500) {
        await manager.insert(PortfolioSnapshot, rows.slice(i, i + 500));
      }
    });

    return { days: rows.length, estimatedDays };
  }

  // --- datos de apoyo ---

  private async loadEvents(userId: string): Promise<LedgerEvent[]> {
    const rows = await this.transactionsRepository.find({
      where: { userId },
      order: { occurredOn: 'ASC', createdAt: 'ASC' },
    });
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
      marketPriceHint: null,
    }));
  }

  async usersWithActivity(): Promise<string[]> {
    return this.usersWithTransactions();
  }

  private async usersWithTransactions(): Promise<string[]> {
    const rows: { user_id: string }[] = await this.transactionsRepository.query(
      `SELECT DISTINCT "user_id" FROM "investment_transactions"`,
    );
    return rows.map((row) => row.user_id);
  }

  private async baseCurrency(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    return user?.baseCurrency ?? 'USD';
  }

  private async instrumentCurrencies(
    instrumentIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (instrumentIds.length === 0) {
      return map;
    }
    const rows: { id: string; currency: string }[] =
      await this.transactionsRepository.query(
        `SELECT "id", "currency" FROM "instruments" WHERE "id" = ANY($1::uuid[])`,
        [instrumentIds],
      );
    for (const row of rows) {
      map.set(row.id, row.currency);
    }
    return map;
  }

  private cashCurrencies(checkpoints: LedgerCheckpoint[]): string[] {
    return [
      ...new Set(
        checkpoints.flatMap((checkpoint) =>
          checkpoint.cash.map((balance) => balance.currency),
        ),
      ),
    ];
  }

  // Rejilla de precios en memoria: una consulta para todo el rango, y luego
  // arrastre del último cierre conocido para cubrir fines de semana y festivos.
  // Sin cota inferior a propósito: hace falta el último cierre ANTERIOR al
  // inicio del rango para poder arrastrarlo al primer día.
  private async priceGrid(
    instrumentIds: string[],
    to: string,
  ): Promise<Map<string, Map<string, PriceCell>>> {
    const grid = new Map<string, Map<string, PriceCell>>();
    if (instrumentIds.length === 0) {
      return grid;
    }
    const rows: { instrument_id: string; price_on: string; close: string }[] =
      await this.snapshotsRepository.query(
        `
          SELECT "instrument_id", "price_on", "close"
          FROM "instrument_prices"
          WHERE "instrument_id" = ANY($1::uuid[]) AND "price_on" <= $2::date
          ORDER BY "instrument_id", "price_on" ASC
        `,
        [instrumentIds, to],
      );
    for (const row of rows) {
      const priceOn = toDateString(row.price_on)!;
      const byDate =
        grid.get(row.instrument_id) ?? new Map<string, PriceCell>();
      byDate.set(priceOn, { close: Number(row.close), priceOn });
      grid.set(row.instrument_id, byDate);
    }
    return grid;
  }

  private priceFor(
    grid: Map<string, Map<string, PriceCell>>,
    instrumentId: string,
    date: string,
  ): PriceCell | null {
    const byDate = grid.get(instrumentId);
    if (!byDate) {
      return null;
    }
    const exact = byDate.get(date);
    if (exact) {
      return exact;
    }
    // arrastra el último cierre anterior (fin de semana, festivo, hueco)
    let best: PriceCell | null = null;
    for (const cell of byDate.values()) {
      if (cell.priceOn <= date && (!best || cell.priceOn > best.priceOn)) {
        best = cell;
      }
    }
    return best;
  }

  private async fxGrid(
    baseCurrency: string,
    currencies: string[],
    to: string,
  ): Promise<Map<string, Map<string, number>>> {
    const grid = new Map<string, Map<string, number>>();
    for (const currency of currencies) {
      if (!currency || currency === baseCurrency) {
        continue;
      }
      const rows: { rate_on: string; rate: string }[] =
        await this.snapshotsRepository.query(
          `
            SELECT DISTINCT ON ("rate_on")
              "rate_on",
              CASE
                WHEN "base_currency" = $1 THEN "rate"
                ELSE 1 / "rate"
              END AS "rate"
            FROM "fx_rates"
            WHERE (
                ("base_currency" = $1 AND "quote_currency" = $2)
                OR
                ("base_currency" = $2 AND "quote_currency" = $1)
              )
              AND "rate_on" <= $3::date
            ORDER BY "rate_on" ASC, ("base_currency" = $1) DESC
          `,
          [currency, baseCurrency, to],
        );
      const byDate = new Map<string, number>();
      for (const row of rows) {
        byDate.set(toDateString(row.rate_on)!, Number(row.rate));
      }
      grid.set(currency, byDate);
    }
    return grid;
  }

  private rateFor(
    grid: Map<string, Map<string, number>>,
    currency: string | undefined,
    date: string,
    baseCurrency: string,
  ): { value: number; estimated: boolean } {
    if (!currency) {
      return { value: 1, estimated: false };
    }
    // La moneda base no está en la rejilla porque no necesita conversión.
    // Sin esta guarda, una posición en la propia moneda base caía al camino de
    // "sin tasa cacheada" y marcaba el día como estimado: con eso, TODOS los
    // días salían estimados y el indicador dejaba de servir para nada.
    if (currency === baseCurrency) {
      return { value: 1, estimated: false };
    }
    const byDate = grid.get(currency);
    if (!byDate) {
      // sin tasa cacheada se asume 1 y el día SÍ queda marcado: es una
      // conversión que no se pudo hacer de verdad
      return { value: 1, estimated: true };
    }
    const exact = byDate.get(date);
    if (exact !== undefined) {
      return { value: exact, estimated: false };
    }
    let best: { rateOn: string; rate: number } | null = null;
    for (const [rateOn, rate] of byDate.entries()) {
      if (rateOn <= date && (!best || rateOn > best.rateOn)) {
        best = { rateOn, rate };
      }
    }
    return best
      ? { value: best.rate, estimated: true }
      : { value: 1, estimated: true };
  }

  // Asegura que las tasas de cambio que hace falta para valorar están en
  // caché. Se mantiene APARTE de buildSnapshots a propósito: construir la serie
  // debe poder hacerse sin red (rebuildPortfolioSnapshots), y solo este método
  // gasta créditos del proveedor.
  async ensureFxRates(
    userId: string,
    from?: string,
    to: string = today(),
  ): Promise<number> {
    const baseCurrency = await this.baseCurrency(userId);
    const currencies = await this.currenciesUsed(userId);
    if (currencies.length === 0) {
      return 0;
    }
    const start = from ?? (await this.firstTransactionDate(userId)) ?? to;
    try {
      return await this.fxService.refreshUserPairs(
        baseCurrency,
        currencies,
        start,
        to,
      );
    } catch (error) {
      // sin tasas la valoración sigue, marcando los días como estimados
      this.logger.warn(
        `No se pudieron refrescar las tasas de ${userId}: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  async firstActivityDate(userId: string): Promise<string | null> {
    return this.firstTransactionDate(userId);
  }

  private async firstTransactionDate(userId: string): Promise<string | null> {
    const [row] = await this.transactionsRepository.query(
      `SELECT MIN("occurred_on") AS first_on FROM "investment_transactions" WHERE "user_id" = $1`,
      [userId],
    );
    return toDateString(row?.first_on);
  }

  // ¿La serie de snapshots va por detrás del libro?
  //
  // Hace falta de verdad: portfolioSummary lee posiciones y precios EN VIVO,
  // mientras que la evolución y las rentabilidades leen los snapshots
  // persistidos. Si se escriben operaciones y no se reconstruye, los dos
  // números discrepan sin avisar; medido en pruebas, la diferencia llegó a ser
  // de 20 puntos de TWR. Mejor decirlo que dejar que el usuario lo descubra.
  async isStale(userId: string): Promise<boolean> {
    const baseCurrency = await this.baseCurrency(userId);
    const [row] = await this.snapshotsRepository.query(
      `
        SELECT
          (SELECT MAX("updated_at") FROM "investment_transactions" WHERE "user_id" = $1) AS last_write,
          (SELECT MAX("created_at") FROM "portfolio_snapshots"
            WHERE "user_id" = $1 AND "base_currency" = $2) AS last_build
      `,
      [userId, baseCurrency],
    );
    if (!row?.last_write) {
      return false;
    }
    if (!row.last_build) {
      return true;
    }
    return new Date(row.last_write) > new Date(row.last_build);
  }

  // --- lectura ---

  async findSeries(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<PortfolioSnapshot[]> {
    const baseCurrency = await this.baseCurrency(userId);
    const query = this.snapshotsRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.user_id = :userId', { userId })
      .andWhere('snapshot.account_id IS NULL')
      // Un snapshot ya está convertido. Nunca puede etiquetarse con la moneda
      // base actual si fue construido con otra: esa mezcla produce retornos de
      // cientos de miles por ciento al cambiar COP <-> USD.
      .andWhere('snapshot.base_currency = :baseCurrency', { baseCurrency })
      .orderBy('snapshot.snapshot_on', 'ASC');
    if (from) {
      query.andWhere('snapshot.snapshot_on >= :from', { from });
    }
    if (to) {
      query.andWhere('snapshot.snapshot_on <= :to', { to });
    }
    return query.getMany();
  }

  async accountIds(userId: string): Promise<string[]> {
    const accounts = await this.accountsRepository.find({
      where: { userId },
      select: { id: true },
    });
    return accounts.map((account) => account.id);
  }

  async currenciesUsed(userId: string): Promise<string[]> {
    const rows: { currency: string }[] =
      await this.transactionsRepository.query(
        `SELECT DISTINCT "currency" FROM "investment_transactions" WHERE "user_id" = $1`,
        [userId],
      );
    return rows.map((row) => row.currency);
  }

  get baseIndex(): number {
    return TWR_BASE_INDEX;
  }
}

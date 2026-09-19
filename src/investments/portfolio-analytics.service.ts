import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EXTERNAL_FLOW_TYPES,
  InvestmentTransactionType,
} from '../common/enums/investment-transaction-type.enum';
import { toDateString } from '../common/date';
import { FxService } from '../market-data/fx.service';
import { Instrument } from '../market-data/entities/instrument.entity';
import { InstrumentsService } from '../market-data/instruments.service';
import { User } from '../users/entities/user.entity';
import { roundMoney, safeDivide } from './analytics/money';
import { AnnualizedStatus, simpleReturn } from './analytics/returns';
import { returnBetween, annualizedBetween } from './analytics/twr';
import { CashFlow, XirrStatus, xirr } from './analytics/xirr';
import { PortfolioEvolution } from './dto/portfolio-evolution.type';
import { PortfolioReturns } from './dto/portfolio-returns.type';
import { SnapshotsService } from './snapshots.service';
import {
  AllocationDimension,
  InvestmentPositionsFilterInput,
} from './dto/investments-filter.input';
import {
  AllocationSlice,
  PortfolioAllocation,
  PortfolioSummary,
  PositionView,
} from './dto/portfolio.type';
import { InvestmentCashBalance } from './entities/investment-cash-balance.entity';
import { InvestmentPosition } from './entities/investment-position.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';

const today = (): string => new Date().toISOString().substring(0, 10);

interface FlowTotals {
  contributions: number;
  withdrawals: number;
  dividends: number;
  interest: number;
  fees: number;
  taxes: number;
  realized: number;
}

@Injectable()
export class PortfolioAnalyticsService {
  constructor(
    @InjectRepository(InvestmentPosition)
    private readonly positionsRepository: Repository<InvestmentPosition>,
    @InjectRepository(InvestmentCashBalance)
    private readonly cashRepository: Repository<InvestmentCashBalance>,
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly instrumentsService: InstrumentsService,
    private readonly fxService: FxService,
    private readonly snapshotsService: SnapshotsService,
  ) {}

  async baseCurrency(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    if (!user) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }
    return user.baseCurrency;
  }

  // --- posiciones valoradas ---

  async positions(
    userId: string,
    filter?: InvestmentPositionsFilterInput,
  ): Promise<PositionView[]> {
    const asOf = filter?.asOf ?? today();
    const rows = await this.positionsRepository.find({
      where: {
        userId,
        ...(filter?.accountId ? { accountId: filter.accountId } : {}),
        ...(filter?.instrumentId ? { instrumentId: filter.instrumentId } : {}),
      },
      relations: { account: true, instrument: true },
    });

    const open = filter?.includeClosed
      ? rows
      : rows.filter((row) => row.quantity !== 0);

    const prices = await this.instrumentsService.latestPrices(
      open.map((row) => row.instrumentId),
      asOf,
    );
    const fx = await this.fxRates(userId, asOf);

    return open
      .map((row) => this.toPositionView(row, prices, fx))
      .sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));
  }

  private toPositionView(
    row: InvestmentPosition,
    prices: Map<string, { close: number; priceOn: string }>,
    fx: Map<string, number>,
  ): PositionView {
    const price = prices.get(row.instrumentId) ?? null;

    // La tasa se toma de la moneda del INSTRUMENTO, no de la del lote.
    //
    // instrument_prices guarda el cierre en la moneda en la que cotiza el
    // instrumento. Convertirlo con la tasa del lote es un error cuando ambas
    // difieren: un bitcoin comprado con pesos tiene el lote en COP y el precio
    // en USD, y aplicarle la tasa COP/USD al precio lo dividía por ~3900. El
    // resultado era una pérdida no realizada del 99,97%.
    const rate = fx.get(row.instrument?.currency ?? row.currency) ?? 1;

    // sin precio NO se valora en 0: se deja en null y se cuenta aparte.
    // Un número ausente es honesto; un cero es una mentira.
    const marketValueBase = price
      ? roundMoney(row.quantity * price.close * rate)
      : null;
    const unrealizedPnlBase =
      marketValueBase === null
        ? null
        : roundMoney(marketValueBase - row.costBasisBase);

    return {
      id: row.id,
      account: row.account,
      instrument: row.instrument,
      quantity: row.quantity,
      averageCost: row.averageCost,
      costBasis: row.costBasis,
      costBasisBase: row.costBasisBase,
      currency: row.currency,
      lastPrice: price?.close ?? null,
      lastPriceOn: price?.priceOn ?? null,
      marketValueBase,
      unrealizedPnlBase,
      unrealizedReturn:
        unrealizedPnlBase === null || row.costBasisBase <= 0
          ? null
          : simpleReturn(marketValueBase!, row.costBasisBase),
      realizedPnlToDateBase: row.realizedPnlToDateBase,
      costBasisIsEstimated: row.costBasisIsEstimated,
      priceMissing: price === null,
    };
  }

  // --- resumen ---

  async summary(userId: string, asOfInput?: string): Promise<PortfolioSummary> {
    const asOf = asOfInput ?? today();
    const baseCurrency = await this.baseCurrency(userId);
    const views = await this.positions(userId, { asOf });
    const totals = await this.flowTotals(userId, asOf);
    const cash = await this.cashInBase(userId, asOf);

    const priced = views.filter((view) => !view.priceMissing);
    const marketValuePositions = priced.reduce(
      (sum, view) => roundMoney(sum + (view.marketValueBase ?? 0)),
      0,
    );
    const costBasis = views.reduce(
      (sum, view) => roundMoney(sum + view.costBasisBase),
      0,
    );
    const unrealizedPnl = priced.reduce(
      (sum, view) => roundMoney(sum + (view.unrealizedPnlBase ?? 0)),
      0,
    );

    const investedCapital = roundMoney(
      totals.contributions - totals.withdrawals,
    );
    const marketValue = roundMoney(marketValuePositions + cash);

    const pricesUsed = priced
      .map((view) => view.lastPriceOn)
      .filter((value): value is string => value !== null);
    const oldestPrice = pricesUsed.length
      ? pricesUsed.reduce((min, value) => (value < min ? value : min))
      : null;

    return {
      baseCurrency,
      asOf,
      investedCapital,
      costBasis,
      marketValue,
      cash,
      unrealizedPnl,
      realizedPnl: totals.realized,
      dividends: totals.dividends,
      interest: totals.interest,
      fees: totals.fees,
      taxes: totals.taxes,
      simpleReturn: simpleReturn(marketValue, investedCapital),
      positionsCount: views.length,
      missingPriceCount: views.length - priced.length,
      estimatedBasisPositionsCount: views.filter(
        (view) => view.costBasisIsEstimated,
      ).length,
      pricesStale: oldestPrice !== null && oldestPrice < asOf,
      pricesAsOf: oldestPrice,
    };
  }

  // --- distribución ---

  async allocation(
    userId: string,
    dimension: AllocationDimension,
    asOfInput?: string,
  ): Promise<PortfolioAllocation> {
    const asOf = asOfInput ?? today();
    const baseCurrency = await this.baseCurrency(userId);
    const views = await this.positions(userId, { asOf });
    const priced = views.filter((view) => !view.priceMissing);

    const buckets = new Map<string, AllocationSlice>();
    for (const view of priced) {
      const { key, label } = this.bucketOf(dimension, view);
      const slice = buckets.get(key) ?? {
        key,
        label,
        marketValue: 0,
        costBasis: 0,
        percentage: 0,
        positionsCount: 0,
      };
      slice.marketValue = roundMoney(
        slice.marketValue + (view.marketValueBase ?? 0),
      );
      slice.costBasis = roundMoney(slice.costBasis + view.costBasisBase);
      slice.positionsCount += 1;
      buckets.set(key, slice);
    }

    const total = [...buckets.values()].reduce(
      (sum, slice) => roundMoney(sum + slice.marketValue),
      0,
    );
    const slices = [...buckets.values()]
      .map((slice) => ({
        ...slice,
        percentage: roundMoney(safeDivide(slice.marketValue, total) * 100),
      }))
      .sort((a, b) => b.marketValue - a.marketValue);

    return {
      asOf,
      baseCurrency,
      total,
      slices,
      missingPriceCount: views.length - priced.length,
    };
  }

  private bucketOf(
    dimension: AllocationDimension,
    view: PositionView,
  ): { key: string; label: string } {
    const instrument: Instrument = view.instrument;
    switch (dimension) {
      case AllocationDimension.BROKER:
        return { key: view.account.broker, label: view.account.name };
      case AllocationDimension.INSTRUMENT:
        return { key: instrument.symbol, label: instrument.name };
      case AllocationDimension.SECTOR:
        return {
          key: instrument.sector ?? 'unknown',
          label: instrument.sector ?? 'Sin sector',
        };
      case AllocationDimension.COUNTRY:
        return {
          key: instrument.country ?? 'unknown',
          label: instrument.country ?? 'Sin país',
        };
      case AllocationDimension.CURRENCY:
        return { key: instrument.currency, label: instrument.currency };
      case AllocationDimension.ASSET_CLASS:
        return { key: instrument.assetClass, label: instrument.assetClass };
    }
  }

  // --- agregados desde el libro ---

  private async flowTotals(userId: string, asOf: string): Promise<FlowTotals> {
    const [row] = await this.transactionsRepository.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN "type" = $3 THEN "amount" * "fx_rate" END), 0) AS contributions,
          COALESCE(SUM(CASE WHEN "type" = $4 THEN "amount" * "fx_rate" END), 0) AS withdrawals,
          COALESCE(SUM(CASE WHEN "type" = $5 THEN ("amount" - "tax" - "fee") * "fx_rate" END), 0) AS dividends,
          COALESCE(SUM(CASE WHEN "type" = $6 THEN ("amount" - "tax" - "fee") * "fx_rate" END), 0) AS interest,
          COALESCE(SUM(CASE WHEN "type" = $7 THEN "amount" * "fx_rate" ELSE "fee" * "fx_rate" END), 0) AS fees,
          COALESCE(SUM(CASE WHEN "type" = $8 THEN "amount" * "fx_rate" ELSE "tax" * "fx_rate" END), 0) AS taxes
        FROM "investment_transactions"
        WHERE "user_id" = $1 AND "occurred_on" <= $2::date
      `,
      [
        userId,
        asOf,
        InvestmentTransactionType.DEPOSIT,
        InvestmentTransactionType.WITHDRAWAL,
        InvestmentTransactionType.DIVIDEND,
        InvestmentTransactionType.INTEREST,
        InvestmentTransactionType.FEE,
        InvestmentTransactionType.TAX,
      ],
    );

    const [realized] = await this.transactionsRepository.query(
      `
        SELECT COALESCE(SUM("realized_pnl_base"), 0) AS realized
        FROM "investment_realizations"
        WHERE "user_id" = $1 AND "realized_on" <= $2::date
      `,
      [userId, asOf],
    );

    return {
      contributions: Number(row.contributions),
      withdrawals: Number(row.withdrawals),
      dividends: Number(row.dividends),
      interest: Number(row.interest),
      fees: Number(row.fees),
      taxes: Number(row.taxes),
      realized: Number(realized.realized),
    };
  }

  private async cashInBase(userId: string, asOf: string): Promise<number> {
    const rows: { currency: string; amount: string }[] =
      await this.cashRepository.query(
        `
          SELECT c."currency", SUM(c."amount") AS amount
          FROM "investment_cash_balances" c
          JOIN "investment_accounts" a ON a."id" = c."account_id"
          WHERE a."user_id" = $1
          GROUP BY c."currency"
        `,
        [userId],
      );
    const fx = await this.fxRates(userId, asOf);
    return rows.reduce(
      (sum, row) =>
        roundMoney(sum + Number(row.amount) * (fx.get(row.currency) ?? 1)),
      0,
    );
  }

  // Tasa de cambio de cada moneda hacia la moneda base del usuario, a la
  // fecha de valoración.
  //
  // Resuelve contra el caché fx_rates (identidad -> directo -> inverso ->
  // puente por USD). Si una moneda no está cacheada se cae a la última tasa
  // que el propio usuario escribió en una operación, y en último término a 1;
  // el resumen lo refleja marcando la valoración como estimada.
  private async fxRates(
    userId: string,
    asOf: string,
  ): Promise<Map<string, number>> {
    const baseCurrency = await this.baseCurrency(userId);
    const rows: { currency: string; fx_rate: string }[] =
      await this.transactionsRepository.query(
        `
          SELECT DISTINCT ON ("currency") "currency", "fx_rate"
          FROM "investment_transactions"
          WHERE "user_id" = $1
          ORDER BY "currency", "occurred_on" DESC, "created_at" DESC
        `,
        [userId],
      );

    const map = new Map<string, number>();
    for (const row of rows) {
      const cached = await this.fxService.rateOn(
        row.currency,
        baseCurrency,
        asOf,
      );
      map.set(row.currency, cached ? cached.rate : Number(row.fx_rate));
    }

    // monedas que solo aparecen en saldos de efectivo o en instrumentos
    const extra: { currency: string }[] = await this.cashRepository.query(
      `
        SELECT DISTINCT c."currency"
        FROM "investment_cash_balances" c
        JOIN "investment_accounts" a ON a."id" = c."account_id"
        WHERE a."user_id" = $1
      `,
      [userId],
    );
    for (const row of extra) {
      if (map.has(row.currency)) {
        continue;
      }
      const cached = await this.fxService.rateOn(
        row.currency,
        baseCurrency,
        asOf,
      );
      map.set(row.currency, cached?.rate ?? 1);
    }
    return map;
  }

  // --- evolución y rentabilidades ---

  async evolution(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<PortfolioEvolution> {
    const baseCurrency = await this.baseCurrency(userId);
    const snapshots = await this.snapshotsService.findSeries(userId, from, to);
    return {
      baseCurrency,
      isStale: await this.snapshotsService.isStale(userId),
      estimatedDays: snapshots.filter((snapshot) => snapshot.isEstimated)
        .length,
      points: snapshots.map((snapshot) => ({
        date: snapshot.snapshotOn,
        totalValue: roundMoney(snapshot.marketValueBase + snapshot.cashBase),
        marketValue: snapshot.marketValueBase,
        cash: snapshot.cashBase,
        costBasis: snapshot.costBasisBase,
        contributions: snapshot.contributionsToDateBase,
        netFlow: snapshot.netFlowBase,
        unrealizedPnl: snapshot.unrealizedPnlBase,
        realizedPnl: snapshot.realizedPnlToDateBase,
        dividends: snapshot.dividendsToDateBase,
        twrIndex: snapshot.twrIndex,
        isEstimated: snapshot.isEstimated,
        missingPriceCount: snapshot.missingPriceCount,
      })),
    };
  }

  // Las tres rentabilidades juntas, porque responden preguntas distintas:
  // la simple dice cuánto ha crecido el dinero, el TWR cómo lo hicieron las
  // inversiones ignorando el momento de los aportes, y el XIRR cuánto has
  // ganado tú de verdad teniendo en cuenta ese momento.
  async returns(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<PortfolioReturns> {
    const baseCurrency = await this.baseCurrency(userId);
    const snapshots = await this.snapshotsService.findSeries(userId, from, to);
    const isStale = await this.snapshotsService.isStale(userId);

    if (snapshots.length === 0) {
      const summary = await this.summary(userId, to);
      return {
        baseCurrency,
        from: from ?? summary.asOf,
        to: to ?? summary.asOf,
        simpleReturn: summary.simpleReturn,
        twr: null,
        twrAnnualized: null,
        twrAnnualizedStatus: AnnualizedStatus.NO_BASE,
        xirr: null,
        xirrStatus: XirrStatus.NOT_ENOUGH_FLOWS,
        endingValue: summary.marketValue,
        investedCapital: summary.investedCapital,
        realizedPnl: summary.realizedPnl,
        unrealizedPnl: summary.unrealizedPnl,
        dividends: summary.dividends,
        isStale,
      };
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const endingValue = roundMoney(last.marketValueBase + last.cashBase);

    // dos lecturas y una división: para esto se persiste twr_index
    const twr = returnBetween(first.twrIndex, last.twrIndex);
    const annualized = annualizedBetween(
      first.twrIndex,
      last.twrIndex,
      first.snapshotOn,
      last.snapshotOn,
    );

    const flows = await this.externalFlows(
      userId,
      first.snapshotOn,
      last.snapshotOn,
    );
    // el valor de mercado final entra como flujo positivo de cierre
    flows.push({ date: last.snapshotOn, amount: endingValue });
    const mwr = xirr(flows);

    const investedCapital = last.contributionsToDateBase;

    return {
      baseCurrency,
      from: first.snapshotOn,
      to: last.snapshotOn,
      simpleReturn: simpleReturn(endingValue, investedCapital),
      twr,
      twrAnnualized: annualized.rate,
      twrAnnualizedStatus: annualized.status,
      xirr: mwr.rate,
      xirrStatus: mwr.status,
      endingValue,
      investedCapital,
      realizedPnl: last.realizedPnlToDateBase,
      unrealizedPnl: last.unrealizedPnlBase,
      dividends: last.dividendsToDateBase,
      isStale,
    };
  }

  // Flujos EXTERNOS desde la perspectiva del inversor: lo que entra a la
  // cartera es negativo y lo que sale, positivo. Los dividendos e intereses son
  // internos y NO aparecen aquí a propósito.
  private async externalFlows(
    userId: string,
    from: string,
    to: string,
  ): Promise<CashFlow[]> {
    const rows: { occurred_on: string; type: string; amount: string }[] =
      await this.transactionsRepository.query(
        `
          SELECT "occurred_on", "type", SUM("amount" * "fx_rate") AS amount
          FROM "investment_transactions"
          WHERE "user_id" = $1
            AND "occurred_on" BETWEEN $2::date AND $3::date
            AND "type" = ANY($4)
          GROUP BY "occurred_on", "type"
          ORDER BY "occurred_on" ASC
        `,
        [userId, from, to, EXTERNAL_FLOW_TYPES],
      );

    return rows.map((row) => {
      const inflow =
        row.type === InvestmentTransactionType.DEPOSIT ||
        row.type === InvestmentTransactionType.TRANSFER_IN;
      return {
        date: toDateString(row.occurred_on)!,
        amount: inflow ? -Number(row.amount) : Number(row.amount),
      };
    });
  }
}

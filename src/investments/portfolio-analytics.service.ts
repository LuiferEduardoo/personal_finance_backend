import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { Instrument } from '../market-data/entities/instrument.entity';
import { InstrumentsService } from '../market-data/instruments.service';
import { User } from '../users/entities/user.entity';
import { roundMoney, safeDivide } from './analytics/money';
import { simpleReturn } from './analytics/returns';
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
    const fx = await this.fxRates(userId);

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
    const rate = fx.get(row.currency) ?? 1;

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
    const cash = await this.cashInBase(userId);

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

  private async cashInBase(userId: string): Promise<number> {
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
    const fx = await this.fxRates(userId);
    return rows.reduce(
      (sum, row) =>
        roundMoney(sum + Number(row.amount) * (fx.get(row.currency) ?? 1)),
      0,
    );
  }

  // Tasa de cambio por moneda hacia la moneda base del usuario.
  //
  // FASE 1: se usa la tasa MÁS RECIENTE que el propio usuario registró en una
  // operación de esa moneda; si no hay ninguna, 1. Es una aproximación
  // consciente, no un caché de mercado: la fase 2 la sustituye por la tabla
  // fx_rates alimentada por Twelve Data. Hasta entonces, valorar en la moneda
  // base una cartera multidivisa arrastra el sesgo de la última tasa que el
  // usuario escribió.
  private async fxRates(userId: string): Promise<Map<string, number>> {
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
      map.set(row.currency, Number(row.fx_rate));
    }
    return map;
  }
}

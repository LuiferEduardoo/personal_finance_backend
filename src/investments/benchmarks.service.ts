import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { toDateString } from '../common/date';
import { FxService } from '../market-data/fx.service';
import {
  BenchmarkKey,
  Instrument,
} from '../market-data/entities/instrument.entity';
import { User } from '../users/entities/user.entity';
import { round } from './analytics/money';
import { AnnualizedStatus, annualize, daysBetween } from './analytics/returns';
import { TWR_BASE_INDEX } from './analytics/twr';
import {
  BenchmarkBasis,
  BenchmarkComparison,
  ComparisonPoint,
  ComparisonSeries,
} from './dto/benchmark-comparison.type';
import { SnapshotsService } from './snapshots.service';

const LABELS: Record<BenchmarkKey, string> = {
  [BenchmarkKey.SP500]: 'S&P 500 (SPY)',
  [BenchmarkKey.NASDAQ100]: 'Nasdaq-100 (QQQ)',
  [BenchmarkKey.MSCI_WORLD]: 'MSCI World (URTH)',
};

@Injectable()
export class BenchmarksService {
  private readonly logger = new Logger(BenchmarksService.name);

  constructor(
    @InjectRepository(Instrument)
    private readonly instrumentsRepository: Repository<Instrument>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly snapshotsService: SnapshotsService,
    private readonly fxService: FxService,
  ) {}

  listBenchmarks(): Promise<Instrument[]> {
    return this.instrumentsRepository.find({
      where: { benchmarkKey: Not(IsNull()) },
      order: { benchmarkKey: 'ASC' },
    });
  }

  // Compara la curva TWR del usuario con la de uno o varios índices, ambas
  // normalizadas a 100 en la fecha inicial.
  async compare(
    userId: string,
    keys: BenchmarkKey[],
    from?: string,
    to?: string,
    inBaseCurrency = true,
  ): Promise<BenchmarkComparison> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    const baseCurrency = user?.baseCurrency ?? 'USD';
    const snapshots = await this.snapshotsService.findSeries(userId, from, to);
    const warnings: string[] = [];

    if (snapshots.length === 0) {
      return {
        baseCurrency,
        from: from ?? '',
        to: to ?? '',
        inBaseCurrency,
        series: [],
        warnings: [
          'No hay serie de la cartera todavía. Registra operaciones y ejecuta refreshInvestmentPrices.',
        ],
      };
    }

    const start = snapshots[0].snapshotOn;
    const end = snapshots[snapshots.length - 1].snapshotOn;
    const baseIndex = snapshots[0].twrIndex || TWR_BASE_INDEX;

    const portfolio: ComparisonSeries = {
      key: 'portfolio',
      label: 'Mi cartera',
      points: snapshots.map((snapshot) => ({
        date: snapshot.snapshotOn,
        index: round((snapshot.twrIndex / baseIndex) * 100, 6),
      })),
      totalReturn: null,
      annualized: null,
      annualizedStatus: AnnualizedStatus.NO_BASE,
      excessReturn: null,
      basis: BenchmarkBasis.TOTAL_RETURN,
    };
    this.finishSeries(portfolio, start, end);

    const series: ComparisonSeries[] = [portfolio];
    const dates = snapshots.map((snapshot) => snapshot.snapshotOn);

    for (const key of keys) {
      const built = await this.buildBenchmark(
        key,
        dates,
        baseCurrency,
        inBaseCurrency,
        warnings,
      );
      if (built) {
        built.excessReturn =
          built.totalReturn !== null && portfolio.totalReturn !== null
            ? round(built.totalReturn - portfolio.totalReturn, 4)
            : null;
        series.push(built);
      }
    }

    return {
      baseCurrency,
      from: start,
      to: end,
      inBaseCurrency,
      series,
      warnings,
    };
  }

  private async buildBenchmark(
    key: BenchmarkKey,
    dates: string[],
    baseCurrency: string,
    inBaseCurrency: boolean,
    warnings: string[],
  ): Promise<ComparisonSeries | null> {
    const instrument = await this.instrumentsRepository.findOne({
      where: { benchmarkKey: key },
    });
    if (!instrument) {
      warnings.push(`No hay instrumento registrado para el índice ${key}`);
      return null;
    }

    // COALESCE porque el plan Basic de Twelve Data NO devuelve adjusted_close:
    // con cierre crudo la serie del índice va SIN dividendos y la comparación
    // le es desfavorable. Se declara en `basis` en vez de disimularlo.
    const rows: { price_on: string; close: string; adjusted: string | null }[] =
      await this.instrumentsRepository.query(
        `
          SELECT "price_on", "close", "adjusted_close" AS adjusted
          FROM "instrument_prices"
          WHERE "instrument_id" = $1 AND "price_on" <= $2::date
          ORDER BY "price_on" ASC
        `,
        [instrument.id, dates[dates.length - 1]],
      );
    if (rows.length === 0) {
      warnings.push(
        `Sin precios cacheados para ${instrument.symbol}: ejecuta refreshInvestmentPrices`,
      );
      return null;
    }

    const hasAdjusted = rows.some((row) => row.adjusted !== null);
    const byDate = new Map<string, number>();
    for (const row of rows) {
      byDate.set(
        toDateString(row.price_on)!,
        Number(row.adjusted ?? row.close),
      );
    }

    const fxRate = inBaseCurrency
      ? await this.fxRates(instrument.currency, baseCurrency, dates)
      : null;

    const points: ComparisonPoint[] = [];
    let base: number | null = null;
    for (const date of dates) {
      const raw = carryForward(byDate, date);
      if (raw === null) {
        continue;
      }
      // Convertir a moneda base ANTES de normalizar no es cosmético: un
      // inversor en COP que compara contra un S&P 500 sin convertir obtiene un
      // número materialmente equivocado, porque el movimiento COP/USD es parte
      // de su rentabilidad real.
      const value = fxRate ? raw * rateOn(fxRate, date) : raw;
      if (base === null) {
        base = value;
      }
      if (!base) {
        continue;
      }
      points.push({ date, index: round((value / base) * 100, 6) });
    }

    if (points.length === 0) {
      warnings.push(
        `Sin datos utilizables de ${instrument.symbol} en el rango`,
      );
      return null;
    }

    const series: ComparisonSeries = {
      key,
      label: LABELS[key] ?? instrument.name,
      points,
      totalReturn: null,
      annualized: null,
      annualizedStatus: AnnualizedStatus.NO_BASE,
      excessReturn: null,
      basis: hasAdjusted
        ? BenchmarkBasis.TOTAL_RETURN
        : BenchmarkBasis.PRICE_ONLY,
    };
    this.finishSeries(series, points[0].date, points[points.length - 1].date);
    if (!hasAdjusted) {
      warnings.push(
        `${instrument.symbol} se compara solo por precio (sin dividendos): el plan actual de Twelve Data no entrega adjusted_close`,
      );
    }
    return series;
  }

  private finishSeries(
    series: ComparisonSeries,
    from: string,
    to: string,
  ): void {
    if (series.points.length === 0) {
      return;
    }
    const growth = series.points[series.points.length - 1].index / 100;
    series.totalReturn = round((growth - 1) * 100, 4);
    const annualized = annualize(growth, daysBetween(from, to));
    series.annualized = annualized.rate;
    series.annualizedStatus = annualized.status;
  }

  private async fxRates(
    currency: string,
    baseCurrency: string,
    dates: string[],
  ): Promise<Map<string, number> | null> {
    if (currency === baseCurrency) {
      return null;
    }
    const map = new Map<string, number>();
    for (const date of dates) {
      const lookup = await this.fxService.rateOn(currency, baseCurrency, date);
      if (lookup) {
        map.set(date, lookup.rate);
      }
    }
    if (map.size === 0) {
      this.logger.warn(
        `Sin tasas ${currency}/${baseCurrency}: el índice se compara en su moneda`,
      );
      return null;
    }
    return map;
  }
}

function carryForward(
  byDate: Map<string, number>,
  date: string,
): number | null {
  const exact = byDate.get(date);
  if (exact !== undefined) {
    return exact;
  }
  let best: { on: string; value: number } | null = null;
  for (const [on, value] of byDate.entries()) {
    if (on <= date && (!best || on > best.on)) {
      best = { on, value };
    }
  }
  return best?.value ?? null;
}

function rateOn(rates: Map<string, number>, date: string): number {
  const exact = rates.get(date);
  if (exact !== undefined) {
    return exact;
  }
  let best: { on: string; value: number } | null = null;
  for (const [on, value] of rates.entries()) {
    if (on <= date && (!best || on > best.on)) {
      best = { on, value };
    }
  }
  return best?.value ?? 1;
}

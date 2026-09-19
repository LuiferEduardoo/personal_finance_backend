import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { toDateString } from '../common/date';
import { InstrumentPrice } from './entities/instrument-price.entity';
import {
  Instrument,
  InstrumentPriceSource,
} from './entities/instrument.entity';
import {
  MarketDataBudgetExhaustedError,
  MarketDataRateLimiter,
} from './rate-limiter.service';
import { TwelveDataClient } from './twelve-data.client';

// Cuántos símbolos van en una misma llamada. Agrupar ahorra VIAJES DE RED,
// no créditos: Twelve Data cobra 1 por símbolo igualmente, y el limitador se
// carga con N. Que nadie "optimice" esto pensando que los lotes salen baratos.
const BATCH_SIZE = 8;

// Si queda holgura de sobra en el día, un backfill recién pedido se intenta al
// momento en vez de esperar al job de la noche.
const OPPORTUNISTIC_BACKFILL_THRESHOLD = 200;

export interface PriceSyncReport {
  refreshed: number;
  backfilled: number;
  creditsUsed: number;
  budgetExhausted: boolean;
  errors: string[];
}

const today = (): string => new Date().toISOString().substring(0, 10);

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    @InjectRepository(Instrument)
    private readonly instrumentsRepository: Repository<Instrument>,
    @InjectRepository(InstrumentPrice)
    private readonly pricesRepository: Repository<InstrumentPrice>,
    private readonly client: TwelveDataClient,
    private readonly limiter: MarketDataRateLimiter,
  ) {}

  // Créditos que quedan hoy. Lo expone el servicio para que quien orquesta
  // varias llamadas pueda reportar el consumo total de forma honesta.
  remainingCredits(): Promise<number> {
    return this.limiter.remainingToday();
  }

  // Último cierre conocido en o antes de `date`. Un hueco de fin de semana o
  // festivo se resuelve arrastrando el cierre anterior; el llamador sabe que
  // es arrastrado porque la fecha devuelta no coincide con la pedida.
  async closeOn(
    instrumentId: string,
    date: string,
  ): Promise<{ close: number; priceOn: string } | null> {
    const [row] = await this.pricesRepository.query(
      `
        SELECT "close", "price_on"
        FROM "instrument_prices"
        WHERE "instrument_id" = $1 AND "price_on" <= $2::date
        ORDER BY "price_on" DESC
        LIMIT 1
      `,
      [instrumentId, date],
    );
    return row
      ? { close: Number(row.close), priceOn: toDateString(row.price_on)! }
      : null;
  }

  // Asegura que el rango pedido está en caché. Se calcula lo que falta y se
  // pide en UNA sola llamada por instrumento, aprovechando que un time_series
  // con outputsize=5000 cuesta 1 crédito y trae hasta 5000 barras.
  async ensureHistory(
    instrument: Instrument,
    from: string,
    to: string,
  ): Promise<number> {
    const gap = await this.missingRange(instrument.id, from, to);
    if (!gap) {
      return 0;
    }
    const symbol = instrument.twelveDataSymbol ?? instrument.symbol;
    const [series] = await this.limiter.schedule(1, () =>
      this.client.timeSeries([symbol], gap.from, gap.to),
    );
    if (!series || series.error) {
      this.logger.warn(
        `Sin histórico para ${symbol}: ${series?.error ?? 'respuesta vacía'}`,
      );
      return 0;
    }
    return this.storeBars(instrument, series.bars);
  }

  // Refresca el último cierre de varios instrumentos, en lotes.
  async refreshLatest(instruments: Instrument[]): Promise<number> {
    let stored = 0;
    const to = today();
    // 7 días atrás cubre fines de semana y festivos largos
    const from = shiftDays(to, -7);

    for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
      const batch = instruments.slice(i, i + BATCH_SIZE);
      const symbols = batch.map(
        (instrument) => instrument.twelveDataSymbol ?? instrument.symbol,
      );
      // se cobran TANTOS créditos como símbolos: el lote ahorra red, no cuota
      const results = await this.limiter.schedule(batch.length, () =>
        this.client.timeSeries(symbols, from, to),
      );
      for (let j = 0; j < batch.length; j += 1) {
        const series = results[j];
        if (!series || series.error) {
          this.logger.warn(
            `Sin precio para ${symbols[j]}: ${series?.error ?? 'respuesta vacía'}`,
          );
          continue;
        }
        stored += await this.storeBars(batch[j], series.bars);
      }
    }
    return stored;
  }

  // Entrada del job nocturno y de la mutación manual. El userId opcional imita
  // a RecurringExpensesService.runDue para que el mismo código sirva a ambos.
  async refreshPrices(userId?: string): Promise<PriceSyncReport> {
    const report: PriceSyncReport = {
      refreshed: 0,
      backfilled: 0,
      creditsUsed: 0,
      budgetExhausted: false,
      errors: [],
    };
    if (!this.client.configured) {
      report.errors.push('falta TWELVEDATA_API_KEY');
      return report;
    }

    const before = await this.limiter.remainingToday();

    try {
      const targets = await this.dailyTargets(userId);
      report.refreshed = await this.refreshLatest(targets);

      // los backfills pendientes se drenan mientras quede presupuesto. La lista
      // de trabajo sale del ESTADO (backfill_requested_from), no de una cola en
      // memoria: por eso la noche siguiente retoma sola donde se quedó.
      const pending = await this.instrumentsRepository.find({
        where: { backfillRequestedFrom: Not(IsNull()) },
        take: 50,
      });
      for (const instrument of pending) {
        if ((await this.limiter.remainingToday()) <= 0) {
          break;
        }
        await this.ensureHistory(
          instrument,
          instrument.backfillRequestedFrom!,
          today(),
        );
        instrument.backfillRequestedFrom = null;
        await this.instrumentsRepository.save(instrument);
        report.backfilled += 1;
      }
    } catch (error) {
      if (error instanceof MarketDataBudgetExhaustedError) {
        // no es un fallo: es el presupuesto haciendo su trabajo. Se para y se
        // retoma mañana.
        report.budgetExhausted = true;
        this.logger.warn(error.message);
      } else {
        report.errors.push((error as Error).message);
        this.logger.error(
          `Fallo refrescando precios: ${(error as Error).message}`,
        );
      }
    }

    report.creditsUsed = Math.max(
      0,
      before - (await this.limiter.remainingToday()),
    );
    return report;
  }

  // Asegura que los benchmarks cubren el rango de la cartera del usuario.
  // Sin esto la comparación arranca donde arranca el índice, no donde arranca
  // la cartera, y el gráfico sale truncado.
  async ensureBenchmarkHistory(from: string): Promise<number> {
    if (!this.client.configured) {
      return 0;
    }
    const benchmarks = await this.instrumentsRepository.find({
      where: { benchmarkKey: Not(IsNull()) },
    });
    let stored = 0;
    for (const benchmark of benchmarks) {
      try {
        stored += await this.ensureHistory(benchmark, from, today());
      } catch (error) {
        if (error instanceof MarketDataBudgetExhaustedError) {
          this.logger.warn(error.message);
          break;
        }
        this.logger.warn(
          `No se pudo completar el histórico de ${benchmark.symbol}: ${(error as Error).message}`,
        );
      }
    }
    return stored;
  }

  // Marca que hace falta histórico desde una fecha. NO bloquea la mutación que
  // lo pide: si hay holgura de sobra se intenta al momento, si no lo recoge el
  // job nocturno.
  async requestBackfill(instrumentId: string, from: string): Promise<void> {
    const instrument = await this.instrumentsRepository.findOne({
      where: { id: instrumentId },
    });
    if (!instrument || !this.client.configured) {
      return;
    }
    if (
      instrument.backfillRequestedFrom &&
      instrument.backfillRequestedFrom <= from
    ) {
      return;
    }
    instrument.backfillRequestedFrom = from;
    await this.instrumentsRepository.save(instrument);

    try {
      if (
        (await this.limiter.remainingToday()) > OPPORTUNISTIC_BACKFILL_THRESHOLD
      ) {
        await this.ensureHistory(instrument, from, today());
        instrument.backfillRequestedFrom = null;
        await this.instrumentsRepository.save(instrument);
      }
    } catch (error) {
      // nunca revienta la mutación del usuario: queda marcado para la noche
      this.logger.warn(
        `Backfill inmediato de ${instrument.symbol} aplazado: ${(error as Error).message}`,
      );
    }
  }

  // --- internos ---

  // Los instrumentos que se refrescan cada noche: los que alguien tiene en
  // cartera hoy más los benchmarks. Ese racionamiento es lo que hace viable
  // el plan gratuito.
  private async dailyTargets(userId?: string): Promise<Instrument[]> {
    if (!userId) {
      return this.instrumentsRepository.find({
        where: { needsDailyPrice: true },
      });
    }
    return this.instrumentsRepository.query(
      `
        SELECT DISTINCT i.*
        FROM "instruments" i
        WHERE i."benchmark_key" IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM "investment_positions" p
             WHERE p."instrument_id" = i."id"
               AND p."user_id" = $1
               AND p."quantity" <> 0
           )
      `,
      [userId],
    );
  }

  private async missingRange(
    instrumentId: string,
    from: string,
    to: string,
  ): Promise<{ from: string; to: string } | null> {
    const [row] = await this.pricesRepository.query(
      `
        SELECT MIN("price_on") AS first_on, MAX("price_on") AS last_on
        FROM "instrument_prices"
        WHERE "instrument_id" = $1 AND "price_on" BETWEEN $2::date AND $3::date
      `,
      [instrumentId, from, to],
    );
    if (!row?.first_on) {
      return { from, to };
    }
    // Se fusionan los huecos de los extremos en UN solo rango. Pedir un rango
    // algo más ancho del necesario cuesta lo mismo (1 crédito) que pedir el
    // exacto, así que no merece la pena trocearlo.
    const first = toDateString(row.first_on)!;
    const last = toDateString(row.last_on)!;
    if (from >= first && to <= last) {
      return null;
    }
    return { from: from < first ? from : first, to: to > last ? to : last };
  }

  private async storeBars(
    instrument: Instrument,
    bars: { date: string; close: number; adjustedClose: number | null }[],
  ): Promise<number> {
    if (bars.length === 0) {
      return 0;
    }
    await this.pricesRepository
      .createQueryBuilder()
      .insert()
      .into(InstrumentPrice)
      .values(
        bars.map((bar) => ({
          instrumentId: instrument.id,
          priceOn: bar.date,
          close: bar.close,
          // El plan Basic de Twelve Data NO devuelve adjusted_close (verificado
          // contra la API, ni con &adjust=all). Queda null y los benchmarks
          // avisan de que comparan solo precio, sin dividendos.
          adjustedClose: bar.adjustedClose,
          currency: instrument.currency,
          source: InstrumentPriceSource.TWELVE_DATA,
        })),
      )
      .orUpdate(
        ['close', 'adjusted_close', 'source'],
        ['instrument_id', 'price_on'],
      )
      .execute();

    const latest = bars[bars.length - 1];
    if (!instrument.lastPriceOn || latest.date >= instrument.lastPriceOn) {
      instrument.lastPrice = latest.close;
      instrument.lastPriceOn = latest.date;
      instrument.lastSyncedAt = new Date();
      instrument.priceSource = InstrumentPriceSource.TWELVE_DATA;
      await this.instrumentsRepository.save(instrument);
    }
    return bars.length;
  }
}

export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

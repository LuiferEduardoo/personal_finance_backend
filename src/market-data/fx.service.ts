import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toDateString } from '../common/date';
import { FxRate } from './entities/fx-rate.entity';
import { InstrumentPriceSource } from './entities/instrument.entity';
import { MarketDataRateLimiter } from './rate-limiter.service';
import { TwelveDataClient } from './twelve-data.client';
import { shiftDays } from './prices.service';

// moneda puente cuando no existe el par directo ni el inverso
const PIVOT = 'USD';

export interface FxLookup {
  rate: number;
  rateOn: string;
  /** true si la tasa se arrastró de un día anterior */
  estimated: boolean;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectRepository(FxRate)
    private readonly fxRepository: Repository<FxRate>,
    private readonly client: TwelveDataClient,
    private readonly limiter: MarketDataRateLimiter,
  ) {}

  // Resuelve por orden: identidad -> directo -> inverso -> puente por USD.
  // En el camino de LECTURA nunca lanza: si falta, arrastra el último valor
  // conocido y lo marca como estimado.
  async rateOn(
    from: string,
    to: string,
    date: string,
  ): Promise<FxLookup | null> {
    const base = from.toUpperCase();
    const quote = to.toUpperCase();
    if (base === quote) {
      return { rate: 1, rateOn: date, estimated: false };
    }

    const direct = await this.lookup(base, quote, date);
    if (direct) {
      return direct;
    }

    const inverse = await this.lookup(quote, base, date);
    if (inverse && inverse.rate !== 0) {
      return {
        rate: 1 / inverse.rate,
        rateOn: inverse.rateOn,
        estimated: inverse.estimated,
      };
    }

    if (base !== PIVOT && quote !== PIVOT) {
      const baseToPivot = await this.rateOn(base, PIVOT, date);
      const pivotToQuote = await this.rateOn(PIVOT, quote, date);
      if (baseToPivot && pivotToQuote) {
        return {
          rate: baseToPivot.rate * pivotToQuote.rate,
          rateOn:
            baseToPivot.rateOn < pivotToQuote.rateOn
              ? baseToPivot.rateOn
              : pivotToQuote.rateOn,
          estimated: baseToPivot.estimated || pivotToQuote.estimated,
        };
      }
    }
    return null;
  }

  // Camino de ESCRITURA: aquí sí se busca la tasa al proveedor si falta, porque
  // se congela en la operación y tiene que ser correcta. Cuesta 1 crédito y
  // ocurre pocas veces.
  async rateForWrite(from: string, to: string, date: string): Promise<number> {
    const cached = await this.rateOn(from, to, date);
    if (cached && !cached.estimated) {
      return cached.rate;
    }
    if (!this.client.configured || from.toUpperCase() === to.toUpperCase()) {
      return cached?.rate ?? 1;
    }
    try {
      await this.ensureHistory(from, to, shiftDays(date, -7), date);
      const refreshed = await this.rateOn(from, to, date);
      return refreshed?.rate ?? cached?.rate ?? 1;
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver ${from}/${to} el ${date}: ${(error as Error).message}`,
      );
      return cached?.rate ?? 1;
    }
  }

  // Un time_series de una pareja cubre un rango entero por 1 crédito.
  async ensureHistory(
    from: string,
    to: string,
    rangeFrom: string,
    rangeTo: string,
  ): Promise<number> {
    const base = from.toUpperCase();
    const quote = to.toUpperCase();
    if (base === quote) {
      return 0;
    }
    const bars = await this.limiter.schedule(1, () =>
      this.client.fxTimeSeries(base, quote, rangeFrom, rangeTo),
    );
    if (bars.length === 0) {
      return 0;
    }
    await this.fxRepository
      .createQueryBuilder()
      .insert()
      .into(FxRate)
      .values(
        bars.map((bar) => ({
          baseCurrency: base,
          quoteCurrency: quote,
          rateOn: bar.date,
          rate: bar.close,
          source: InstrumentPriceSource.TWELVE_DATA,
        })),
      )
      .orUpdate(
        ['rate', 'source'],
        ['base_currency', 'quote_currency', 'rate_on'],
      )
      .execute();
    return bars.length;
  }

  // Refresca las parejas que el usuario realmente usa: las monedas de sus
  // operaciones contra su moneda base. Suelen ser dos o tres.
  async refreshUserPairs(
    baseCurrency: string,
    currencies: string[],
    rangeFrom: string,
    rangeTo: string,
  ): Promise<number> {
    let stored = 0;
    const unique = [...new Set(currencies.map((c) => c.toUpperCase()))].filter(
      (currency) => currency !== baseCurrency.toUpperCase(),
    );
    for (const currency of unique) {
      stored += await this.ensureHistory(
        currency,
        baseCurrency,
        rangeFrom,
        rangeTo,
      );
    }
    return stored;
  }

  private async lookup(
    base: string,
    quote: string,
    date: string,
  ): Promise<FxLookup | null> {
    const [row] = await this.fxRepository.query(
      `
        SELECT "rate", "rate_on"
        FROM "fx_rates"
        WHERE "base_currency" = $1 AND "quote_currency" = $2 AND "rate_on" <= $3::date
        ORDER BY "rate_on" DESC
        LIMIT 1
      `,
      [base, quote, date],
    );
    if (!row) {
      return null;
    }
    const rateOn = toDateString(row.rate_on)!;
    return {
      rate: Number(row.rate),
      rateOn,
      estimated: rateOn !== date,
    };
  }
}

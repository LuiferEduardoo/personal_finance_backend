import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketDataUsage } from './entities/market-data-usage.entity';

export const TWELVE_DATA_PROVIDER = 'twelve_data';
export const USAGE_COUNTER_STORE = Symbol('USAGE_COUNTER_STORE');

export interface UsageSnapshot {
  minuteCredits: number;
  dayCredits: number;
}

// Se extrae a interfaz para que la aritmética del limitador (vuelta de minuto,
// agotamiento diario) sea testeable con un doble en memoria, sin base de datos.
export interface UsageCounterStore {
  /** Suma créditos al minuto en curso y devuelve el consumo resultante */
  addCredits(provider: string, credits: number): Promise<UsageSnapshot>;
  /** Consumo actual sin sumar nada */
  peek(provider: string): Promise<UsageSnapshot>;
}

// El presupuesto se agotó por hoy. Es un error TIPADO a propósito: los caminos
// de lectura lo capturan y sirven caché, los de escritura lo registran y paran.
export class MarketDataBudgetExhaustedError extends Error {
  constructor(
    readonly provider: string,
    readonly dayCredits: number,
    readonly dayLimit: number,
  ) {
    super(
      `Presupuesto diario de ${provider} agotado (${dayCredits}/${dayLimit} créditos)`,
    );
    this.name = 'MarketDataBudgetExhaustedError';
  }
}

@Injectable()
export class PostgresUsageCounterStore implements UsageCounterStore {
  constructor(
    @InjectRepository(MarketDataUsage)
    private readonly usageRepository: Repository<MarketDataUsage>,
  ) {}

  // Un solo statement atómico. Es lo que hace que un reinicio o una segunda
  // instancia no puedan reventar la cuota: el contador no vive en memoria.
  async addCredits(provider: string, credits: number): Promise<UsageSnapshot> {
    const [row] = await this.usageRepository.query(
      `
        INSERT INTO "market_data_usage" ("provider", "window_minute", "credits")
        VALUES ($1, date_trunc('minute', now()), $2)
        ON CONFLICT ("provider", "window_minute")
        DO UPDATE SET "credits" = "market_data_usage"."credits" + EXCLUDED."credits"
        RETURNING "credits"
      `,
      [provider, credits],
    );
    const [day] = await this.usageRepository.query(
      `
        SELECT COALESCE(SUM("credits"), 0) AS credits
        FROM "market_data_usage"
        WHERE "provider" = $1 AND "window_minute" >= date_trunc('day', now())
      `,
      [provider],
    );
    return {
      minuteCredits: Number(row.credits),
      dayCredits: Number(day.credits),
    };
  }

  async peek(provider: string): Promise<UsageSnapshot> {
    const [row] = await this.usageRepository.query(
      `
        SELECT
          COALESCE(SUM("credits") FILTER (
            WHERE "window_minute" = date_trunc('minute', now())
          ), 0) AS minute_credits,
          COALESCE(SUM("credits") FILTER (
            WHERE "window_minute" >= date_trunc('day', now())
          ), 0) AS day_credits
        FROM "market_data_usage"
        WHERE "provider" = $1
      `,
      [provider],
    );
    return {
      minuteCredits: Number(row.minute_credits),
      dayCredits: Number(row.day_credits),
    };
  }
}

export interface RateLimiterOptions {
  creditsPerMinute: number;
  creditsPerDay: number;
  provider?: string;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Limitador híbrido, sin Redis:
//
//  - EN PROCESO: una cadena de promesas serializa las llamadas salientes y las
//    espacia 60000/creditsPerMinute ms por crédito. Resuelve el orden y la
//    concurrencia dentro de este proceso.
//  - EN BASE DE DATOS: el contador durable de arriba, que sobrevive a
//    reinicios y a una segunda instancia.
//
// Los límites salen de variables de entorno para que subir de plan sea
// configuración y no código.
@Injectable()
export class MarketDataRateLimiter {
  private readonly logger = new Logger(MarketDataRateLimiter.name);
  private readonly creditsPerMinute: number;
  private readonly creditsPerDay: number;
  private readonly provider: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(USAGE_COUNTER_STORE) private readonly store: UsageCounterStore,
    @Optional() configService?: ConfigService,
    @Optional() @Inject('RATE_LIMITER_OPTIONS') options?: RateLimiterOptions,
  ) {
    this.creditsPerMinute =
      options?.creditsPerMinute ??
      Number(configService?.get('TWELVEDATA_CREDITS_PER_MINUTE') ?? 8);
    this.creditsPerDay =
      options?.creditsPerDay ??
      Number(configService?.get('TWELVEDATA_CREDITS_PER_DAY') ?? 800);
    this.provider = options?.provider ?? TWELVE_DATA_PROVIDER;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  get minuteLimit(): number {
    return this.creditsPerMinute;
  }

  get dayLimit(): number {
    return this.creditsPerDay;
  }

  async remainingToday(): Promise<number> {
    const { dayCredits } = await this.store.peek(this.provider);
    return Math.max(0, this.creditsPerDay - dayCredits);
  }

  // Encola la llamada, cobra los créditos y la ejecuta. Todo el tráfico
  // saliente al proveedor debe pasar por aquí.
  schedule<T>(credits: number, call: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.charge(credits);
      return call();
    });
    // la cola no debe romperse porque una llamada falle
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async charge(credits: number): Promise<void> {
    const before = await this.store.peek(this.provider);
    if (before.dayCredits + credits > this.creditsPerDay) {
      throw new MarketDataBudgetExhaustedError(
        this.provider,
        before.dayCredits,
        this.creditsPerDay,
      );
    }

    // si el minuto en curso no da para estos créditos, se espera al siguiente
    if (before.minuteCredits + credits > this.creditsPerMinute) {
      const waitMs = msToNextMinute();
      this.logger.debug(
        `Presupuesto del minuto agotado (${before.minuteCredits}/${this.creditsPerMinute}); espera ${waitMs} ms`,
      );
      await this.sleep(waitMs);
    }

    const after = await this.store.addCredits(this.provider, credits);
    if (after.dayCredits > this.creditsPerDay) {
      throw new MarketDataBudgetExhaustedError(
        this.provider,
        after.dayCredits,
        this.creditsPerDay,
      );
    }

    // espaciado entre llamadas dentro del mismo minuto
    const spacingMs = Math.ceil((60_000 / this.creditsPerMinute) * credits);
    await this.sleep(spacingMs);
  }
}

function msToNextMinute(now: Date = new Date()): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
}

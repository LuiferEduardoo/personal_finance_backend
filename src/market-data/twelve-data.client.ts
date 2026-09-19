import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Cliente de Twelve Data. Usa el fetch nativo a propósito: no hace falta axios
// ni @nestjs/axios para ~150 líneas, y Node 20+ trae fetch estable.
//
// Sigue la forma de InvoicesService: construcción perezosa para que arrancar sin
// clave no rompa el boot, errores del proveedor envueltos en BadGatewayException
// y un Logger propio.

const BASE_URL = 'https://api.twelvedata.com';
const TIMEOUT_MS = 15_000;
// un time_series con outputsize=5000 cuesta 1 crédito y devuelve hasta 5000
// barras diarias: por eso siempre se piden rangos anchos, nunca día a día
export const MAX_OUTPUT_SIZE = 5000;

export interface DailyBar {
  date: string;
  close: number;
  adjustedClose: number | null;
}

export interface TimeSeriesResult {
  symbol: string;
  bars: DailyBar[];
  currency: string | null;
  error: string | null;
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string | null;
  micCode: string | null;
  country: string | null;
  currency: string | null;
  instrumentType: string | null;
}

@Injectable()
export class TwelveDataClient {
  private readonly logger = new Logger(TwelveDataClient.name);
  private apiKey: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.configService.get<string>('TWELVEDATA_API_KEY'));
  }

  private getApiKey(): string {
    if (!this.apiKey) {
      const key = this.configService.get<string>('TWELVEDATA_API_KEY');
      if (!key) {
        throw new ServiceUnavailableException(
          'Los precios de mercado no están configurados (falta TWELVEDATA_API_KEY)',
        );
      }
      this.apiKey = key;
    }
    return this.apiKey;
  }

  // Serie diaria de uno o varios símbolos. Los símbolos van separados por comas:
  // eso ahorra viajes de red, NO créditos (se cobra 1 por símbolo igualmente).
  async timeSeries(
    symbols: string[],
    from: string,
    to: string,
  ): Promise<TimeSeriesResult[]> {
    if (symbols.length === 0) {
      return [];
    }
    const payload = await this.request<Record<string, unknown>>(
      '/time_series',
      {
        symbol: symbols.join(','),
        interval: '1day',
        start_date: from,
        end_date: to,
        outputsize: String(MAX_OUTPUT_SIZE),
        order: 'ASC',
      },
    );
    return this.parseTimeSeries(symbols, payload);
  }

  private parseTimeSeries(
    symbols: string[],
    payload: Record<string, unknown>,
  ): TimeSeriesResult[] {
    // con un solo símbolo la respuesta es el objeto de la serie; con varios,
    // un mapa de símbolo -> serie
    const single = symbols.length === 1 && 'values' in payload;
    return symbols.map((symbol) => {
      const node = (single ? payload : payload[symbol]) as
        Record<string, unknown> | undefined;
      if (!node) {
        return { symbol, bars: [], currency: null, error: 'sin datos' };
      }
      if (node.status === 'error') {
        return {
          symbol,
          bars: [],
          currency: null,
          error: String(node.message ?? 'error del proveedor'),
        };
      }
      const meta = (node.meta ?? {}) as Record<string, unknown>;
      const values = Array.isArray(node.values) ? node.values : [];
      const bars: DailyBar[] = [];
      for (const raw of values as Record<string, string>[]) {
        const close = Number(raw.close);
        if (!raw.datetime || !Number.isFinite(close)) {
          continue;
        }
        bars.push({
          date: raw.datetime.substring(0, 10),
          close,
          adjustedClose: Number.isFinite(Number(raw.adjusted_close))
            ? Number(raw.adjusted_close)
            : null,
        });
      }
      return {
        symbol,
        bars,
        currency: meta.currency ? String(meta.currency) : null,
        error: null,
      };
    });
  }

  // Tasa de cambio actual entre dos monedas (1 crédito).
  async exchangeRate(base: string, quote: string): Promise<number | null> {
    const payload = await this.request<Record<string, unknown>>(
      '/exchange_rate',
      { symbol: `${base}/${quote}` },
    );
    if (payload.status === 'error') {
      this.logger.warn(
        `Twelve Data no resolvió ${base}/${quote}: ${String(payload.message)}`,
      );
      return null;
    }
    const rate = Number(payload.rate);
    return Number.isFinite(rate) ? rate : null;
  }

  // Serie histórica de una pareja de divisas, para rellenar el caché de un
  // rango entero con 1 crédito.
  async fxTimeSeries(
    base: string,
    quote: string,
    from: string,
    to: string,
  ): Promise<DailyBar[]> {
    const [series] = await this.timeSeries([`${base}/${quote}`], from, to);
    return series?.bars ?? [];
  }

  async symbolSearch(query: string): Promise<SymbolMatch[]> {
    const payload = await this.request<Record<string, unknown>>(
      '/symbol_search',
      { symbol: query, outputsize: '10' },
    );
    const data = Array.isArray(payload.data) ? payload.data : [];
    return (data as Record<string, string>[]).map((row) => ({
      symbol: row.symbol,
      name: row.instrument_name ?? row.symbol,
      exchange: row.exchange ?? null,
      micCode: row.mic_code ?? null,
      country: row.country ?? null,
      currency: row.currency ?? null,
      instrumentType: row.instrument_type ?? null,
    }));
  }

  private async request<T>(
    path: string,
    params: Record<string, string | undefined>,
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set('apikey', this.getApiKey());

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new BadGatewayException(
        `No se pudo contactar con Twelve Data: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      // el cuerpo lleva el motivo real (símbolo desconocido, plan insuficiente,
      // créditos agotados). Tirarlo deja el fallo sin diagnóstico.
      const detail = await response.text().catch(() => '');
      throw new BadGatewayException(
        `Twelve Data respondió ${response.status} en ${path}` +
          (detail ? `: ${detail.slice(0, 300)}` : ''),
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new BadGatewayException(
        `Respuesta ilegible de Twelve Data: ${(error as Error).message}`,
      );
    }
  }
}

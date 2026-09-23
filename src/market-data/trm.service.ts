import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type LatestTrm = { value: number; validFrom: string; validTo: string };

const MONTHS: Record<string, string> = {
  jan: '01',
  ene: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  abr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  ago: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
  dic: '12',
};

export function parseLatestTrm(html: string): LatestTrm | null {
  const row = html.match(
    /<td[^>]*>\s*TRM\s*<\/td>\s*<td[^>]*>\s*COP\s*<\/td>\s*<td[^>]*>\s*([\d,.]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i,
  );
  const value = Number(row?.[1]?.replaceAll(',', ''));
  if (!row || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const dates = [...row[2].matchAll(/(\d{2})[-/]([A-Za-z]{3})[-/](\d{4})/g)].map(
    ([, day, month, year]) => {
      const monthNumber = MONTHS[month.toLowerCase()];
      return monthNumber ? `${year}-${monthNumber}-${day}` : null;
    },
  );
  if (!dates[0]) {
    return null;
  }

  return { value, validFrom: dates[0], validTo: dates[1] ?? dates[0] };
}

export function trmRate(from: string, to: string, trm: number): number {
  if (from === to) return 1;
  if (from === 'USD' && to === 'COP') return trm;
  if (from === 'COP' && to === 'USD') return 1 / trm;
  throw new Error(`La TRM no soporta la conversión ${from}/${to}`);
}

@Injectable()
export class TrmService {
  private cached: { expiresAt: number; quote: LatestTrm } | null = null;

  async latest(): Promise<LatestTrm> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return this.cached.quote;
    const response = await fetch(
      'https://www.superfinanciera.gov.co/CargaDriver/',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok)
      throw new ServiceUnavailableException(
        'No se pudo consultar la TRM oficial',
      );
    const html = await response.text();
    const quote = parseLatestTrm(html);
    if (!quote)
      throw new ServiceUnavailableException(
        'La fuente oficial devolvió una TRM inválida',
      );
    this.cached = { expiresAt: Date.now() + 3_600_000, quote };
    return quote;
  }
}

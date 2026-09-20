import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type LatestTrm = { value: number; validFrom: string; validTo: string };

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
    const match = html.match(
      /<td[^>]*>TRM\s*<\/td>\s*<td[^>]*>COP<\/td>\s*<td[^>]*>([\d,.]+)<\/td>\s*<td>(\d{2})\/([A-Za-z]{3})\/(\d{4})\s*-\s*(\d{2})\/([A-Za-z]{3})\/(\d{4})<\/td>/i,
    );
    const value = Number(match?.[1]?.replaceAll(',', ''));
    if (!Number.isFinite(value) || value <= 0)
      throw new ServiceUnavailableException(
        'La fuente oficial devolvió una TRM inválida',
      );
    const months: Record<string, string> = {
      Jan: '01',
      Feb: '02',
      Mar: '03',
      Apr: '04',
      May: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Oct: '10',
      Nov: '11',
      Dec: '12',
    };
    const validFrom = match
      ? `${match[4]}-${months[match[3]]}-${match[2]}`
      : '';
    const validTo = match ? `${match[7]}-${months[match[6]]}-${match[5]}` : '';
    const quote = { value, validFrom, validTo };
    this.cached = { expiresAt: Date.now() + 3_600_000, quote };
    return quote;
  }
}

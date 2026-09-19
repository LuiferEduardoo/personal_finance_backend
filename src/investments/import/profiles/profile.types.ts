import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';

// Campos canónicos a los que se mapea cualquier columna de cualquier bróker.
export type CanonicalField =
  | 'type'
  | 'occurredOn'
  | 'occurredAt'
  | 'symbol'
  | 'isin'
  | 'quantity'
  | 'price'
  | 'amount'
  | 'fee'
  | 'tax'
  | 'currency'
  | 'externalId'
  | 'notes';

// Un perfil es un objeto plano, sin jerarquía de clases: lo único que hace es
// declarar cómo se llaman las columnas en ese bróker y cómo se traducen sus
// nombres de operación. Añadir un bróker nuevo es añadir un archivo.
export interface ParserProfile {
  id: string;
  broker: BrokerKind;
  /** Confianza de 0 a 1 de que estas cabeceras son de este bróker */
  detect(headers: string[]): number;
  columns: Partial<Record<CanonicalField, string[]>>;
  typeMap: Record<string, InvestmentTransactionType>;
  /** 'DMY' cuando el bróker escribe 01/09/2026 como 1 de septiembre */
  dateOrder?: 'DMY' | 'MDY' | 'YMD';
  decimalSeparator?: '.' | ',';
}

// normaliza una cabecera para comparar: minúsculas, sin acentos, sin
// puntuación. "Fecha de operación" y "fecha_de_operacion" son la misma.
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// proporción de las cabeceras esperadas que aparecen de verdad
export function matchScore(headers: string[], expected: string[]): number {
  if (expected.length === 0) {
    return 0;
  }
  const normalized = new Set(headers.map(normalizeHeader));
  const hits = expected.filter((value) =>
    normalized.has(normalizeHeader(value)),
  ).length;
  return hits / expected.length;
}

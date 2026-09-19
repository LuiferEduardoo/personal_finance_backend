import { createHash } from 'crypto';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';

// Huella de deduplicación de una operación.
//
// Vive en la raíz del módulo (y no en import/, como podría sugerir su nombre)
// porque la necesitan por igual la creación manual, la importación de archivos
// y la sincronización con brókers: toda fila que entra al libro lleva hash.
//
// Junto al índice único (user_id, dedupe_hash) es lo que hace que reimportar el
// mismo CSV o resincronizar el mismo periodo sea gratis, y lo que atrapa el
// caso realmente molesto: la MISMA operación llegando por CSV y por API.
export interface DedupeInput {
  userId: string;
  accountId: string;
  type: InvestmentTransactionType;
  occurredOn: string;
  instrumentId: string | null;
  quantity: number | null;
  amount: number;
  currency: string;
  externalId: string | null;
  occurrenceIndex: number;
}

export function dedupeHash(input: DedupeInput): string {
  // toFixed fija la representación: 10 y 10.0 tienen que dar el mismo hash
  // vengan del parser que vengan.
  const parts = [
    input.userId,
    input.accountId,
    input.type,
    input.occurredOn,
    input.instrumentId ?? '',
    (input.quantity ?? 0).toFixed(10),
    input.amount.toFixed(6),
    input.currency.toUpperCase(),
    input.externalId ?? '',
    String(input.occurrenceIndex),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

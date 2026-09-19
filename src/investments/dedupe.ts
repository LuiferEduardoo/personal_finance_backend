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
// caso realmente molesto: la MISMA operación llegando por dos vías distintas.
//
// El externalId NO entra en el hash, a propósito. Entraba al principio, y eso
// rompía justo el caso que el hash existe para cubrir: la misma compra llegando
// por CSV (con la referencia del bróker) y por PDF o por API (sin ella) daba
// dos hashes distintos y se duplicaba. El id externo ya tiene su propio índice
// único (connection_id, external_id) para las sincronizaciones; aquí lo que
// identifica la operación es su clave NATURAL.
//
// Dos operaciones genuinamente distintas con la misma clave natural el mismo
// día se distinguen con occurrenceIndex: para eso está.
export interface DedupeInput {
  userId: string;
  accountId: string;
  type: InvestmentTransactionType;
  occurredOn: string;
  instrumentId: string | null;
  quantity: number | null;
  amount: number;
  currency: string;
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
    String(input.occurrenceIndex),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

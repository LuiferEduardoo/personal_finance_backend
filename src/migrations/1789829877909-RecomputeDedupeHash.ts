import { MigrationInterface, QueryRunner } from 'typeorm';
import { dedupeHash } from '../investments/dedupe';

// El dedupe_hash dejó de incluir el external_id.
//
// Incluirlo rompía justo el caso que el hash existe para cubrir: la misma
// operación llegando por CSV (con la referencia del bróker) y por PDF o por
// sincronización (sin ella) daba dos hashes distintos y se duplicaba. El id
// externo conserva su propio índice único (connection_id, external_id) para las
// sincronizaciones.
//
// Como la función cambió, las filas ya escritas tienen hashes obsoletos y hay
// que recalcularlos: si no, reimportar un archivo ya importado volvería a
// insertarlo.
export class RecomputeDedupeHash1789800000000 implements MigrationInterface {
  name = 'RecomputeDedupeHash1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: {
      id: string;
      user_id: string;
      account_id: string;
      type: string;
      occurred_on: Date | string;
      instrument_id: string | null;
      quantity: string | null;
      amount: string;
      currency: string;
      occurrence_index: number;
    }[] = await queryRunner.query(`
      SELECT "id", "user_id", "account_id", "type", "occurred_on",
             "instrument_id", "quantity", "amount", "currency", "occurrence_index"
      FROM "investment_transactions"
    `);

    for (const row of rows) {
      const occurredOn =
        row.occurred_on instanceof Date
          ? `${row.occurred_on.getFullYear()}-${String(
              row.occurred_on.getMonth() + 1,
            ).padStart(
              2,
              '0',
            )}-${String(row.occurred_on.getDate()).padStart(2, '0')}`
          : String(row.occurred_on).substring(0, 10);

      const hash = dedupeHash({
        userId: row.user_id,
        accountId: row.account_id,
        type: row.type as never,
        occurredOn,
        instrumentId: row.instrument_id,
        quantity: row.quantity === null ? null : Number(row.quantity),
        amount: Number(row.amount),
        currency: row.currency,
        occurrenceIndex: row.occurrence_index,
      });

      await queryRunner.query(
        `UPDATE "investment_transactions" SET "dedupe_hash" = $2 WHERE "id" = $1`,
        [row.id, hash],
      );
    }
  }

  public async down(): Promise<void> {
    // No se puede revertir: el hash anterior dependía de una función que ya no
    // existe. Volver atrás exigiría restaurar también el código anterior.
  }
}

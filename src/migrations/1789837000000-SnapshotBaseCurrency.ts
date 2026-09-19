import { MigrationInterface, QueryRunner } from 'typeorm';

export class SnapshotBaseCurrency1789837000000 implements MigrationInterface {
  name = 'SnapshotBaseCurrency1789837000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ADD "base_currency" character(3)`,
    );

    // Los snapshots existentes no registran con qué moneda se calcularon. No
    // es seguro inferirla desde users.base_currency: esa moneda pudo cambiar
    // después de construirlos. Son datos derivados y se pueden reconstruir.
    await queryRunner.query(`DELETE FROM "portfolio_snapshots"`);
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ALTER COLUMN "base_currency" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" DROP COLUMN "base_currency"`,
    );
  }
}

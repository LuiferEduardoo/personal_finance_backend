import { MigrationInterface, QueryRunner } from 'typeorm';

export class FinanceBaseCurrency1789839000000 implements MigrationInterface {
  name = 'FinanceBaseCurrency1789839000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "finance_base_currency" character(3)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "finance_base_currency" = "base_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "finance_base_currency" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "finance_base_currency" SET DEFAULT 'COP'`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "finance_base_currency"`,
    );
  }
}

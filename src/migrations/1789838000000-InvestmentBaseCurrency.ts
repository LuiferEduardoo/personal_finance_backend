import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvestmentBaseCurrency1789838000000 implements MigrationInterface {
  name = 'InvestmentBaseCurrency1789838000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "investment_base_currency" character(3)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "investment_base_currency" = "base_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "investment_base_currency" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "investment_base_currency" SET DEFAULT 'COP'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "investment_base_currency"`,
    );
  }
}

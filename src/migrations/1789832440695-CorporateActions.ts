import { MigrationInterface, QueryRunner } from 'typeorm';

export class CorporateActions1789832440695 implements MigrationInterface {
  name = 'CorporateActions1789832440695';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "corporate_action_type" AS ENUM('dividend', 'split')`,
    );
    await queryRunner.query(
      `CREATE TABLE "instrument_corporate_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "instrument_id" uuid NOT NULL, "type" "corporate_action_type" NOT NULL, "ex_date" date NOT NULL, "pay_date" date, "amount" numeric(24,10), "ratio_numerator" integer, "ratio_denominator" integer, "currency" character(3), "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_697adfabd5fb3a92710f5274f85" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_corporate_actions" ON "instrument_corporate_actions" ("instrument_id", "type", "ex_date") `,
    );
    await queryRunner.query(
      `ALTER TABLE "instrument_corporate_actions" ADD CONSTRAINT "FK_e9a7f1cf6c3467be7023c4f5996" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instrument_corporate_actions" DROP CONSTRAINT "FK_e9a7f1cf6c3467be7023c4f5996"`,
    );
    await queryRunner.query(`DROP INDEX "uq_corporate_actions"`);
    await queryRunner.query(`DROP TABLE "instrument_corporate_actions"`);
    await queryRunner.query(`DROP TYPE "corporate_action_type"`);
  }
}

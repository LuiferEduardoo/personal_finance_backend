import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountBalancesAndTransfers1784728759581 implements MigrationInterface {
    name = 'AccountBalancesAndTransfers1784728759581'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "account_transfers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "from_account_id" uuid NOT NULL, "to_account_id" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "occurred_on" date NOT NULL, "note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "account_transfers_distinct_check" CHECK ("from_account_id" <> "to_account_id"), CONSTRAINT "account_transfers_amount_check" CHECK ("amount" > 0), CONSTRAINT "PK_9f867cea579976524868172e9b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_account_transfers_from" ON "account_transfers" ("from_account_id") `);
        await queryRunner.query(`CREATE INDEX "idx_account_transfers_to" ON "account_transfers" ("to_account_id") `);
        await queryRunner.query(`ALTER TABLE "payment_methods" ADD "balance" numeric(14,2) NOT NULL DEFAULT '0'`);
        // backfill: las cuentas existentes arrancan con su saldo inicial
        await queryRunner.query(`UPDATE "payment_methods" SET "balance" = "opening_balance"`);
        await queryRunner.query(`ALTER TABLE "account_transfers" ADD CONSTRAINT "FK_41576f5f1cdcf4790d895391dc4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_transfers" ADD CONSTRAINT "FK_6d564162c70da570eaff88ab28f" FOREIGN KEY ("from_account_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_transfers" ADD CONSTRAINT "FK_8e33aa4101ca49273e7d37b9e5f" FOREIGN KEY ("to_account_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "account_transfers" DROP CONSTRAINT "FK_8e33aa4101ca49273e7d37b9e5f"`);
        await queryRunner.query(`ALTER TABLE "account_transfers" DROP CONSTRAINT "FK_6d564162c70da570eaff88ab28f"`);
        await queryRunner.query(`ALTER TABLE "account_transfers" DROP CONSTRAINT "FK_41576f5f1cdcf4790d895391dc4"`);
        await queryRunner.query(`ALTER TABLE "payment_methods" DROP COLUMN "balance"`);
        await queryRunner.query(`DROP INDEX "public"."idx_account_transfers_to"`);
        await queryRunner.query(`DROP INDEX "public"."idx_account_transfers_from"`);
        await queryRunner.query(`DROP TABLE "account_transfers"`);
    }

}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvestmentsCore1789793877306 implements MigrationInterface {
  name = 'InvestmentsCore1789793877306';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "instrument_asset_class" AS ENUM('equity', 'etf', 'fund', 'bond', 'crypto', 'forex', 'commodity', 'cfd', 'cash', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "instrument_price_source" AS ENUM('twelve_data', 'manual', 'broker', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "benchmark_key" AS ENUM('sp500', 'nasdaq100', 'msci_world')`,
    );
    await queryRunner.query(
      `CREATE TABLE "instruments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "symbol" text NOT NULL, "exchange" text, "mic_code" text, "name" text NOT NULL, "asset_class" "instrument_asset_class" NOT NULL DEFAULT 'equity', "currency" character(3) NOT NULL, "sector" text, "industry" text, "country" character(2), "isin" text, "twelve_data_symbol" text, "price_source" "instrument_price_source" NOT NULL DEFAULT 'manual', "needs_daily_price" boolean NOT NULL DEFAULT false, "backfill_requested_from" date, "benchmark_key" "benchmark_key", "last_price" numeric(24,10), "last_price_on" date, "last_synced_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "instruments_symbol_unique" UNIQUE ("symbol", "exchange"), CONSTRAINT "PK_44d772c3199b38559c5fb666eb6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_instruments_needs_price" ON "instruments" ("needs_daily_price") WHERE "needs_daily_price"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_instruments_benchmark" ON "instruments" ("benchmark_key") WHERE "benchmark_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_instruments_isin" ON "instruments" ("isin") WHERE "isin" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "instrument_prices" ("instrument_id" uuid NOT NULL, "price_on" date NOT NULL, "close" numeric(24,10) NOT NULL, "adjusted_close" numeric(24,10), "currency" character(3) NOT NULL, "source" "instrument_price_source" NOT NULL DEFAULT 'twelve_data', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_34befa6f77aab4bb6e398396a31" PRIMARY KEY ("instrument_id", "price_on"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "broker_kind" AS ENUM('etoro', 'interactive_brokers', 'binance', 'xtb', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "connection_id" uuid, "broker" "broker_kind" NOT NULL DEFAULT 'manual', "external_account_id" text, "name" text NOT NULL, "currency" character(3) NOT NULL DEFAULT 'USD', "linked_payment_method_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a621bf380054f84bd72ff079164" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_investment_accounts_external" ON "investment_accounts" ("user_id", "connection_id", "external_account_id") WHERE "external_account_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_accounts_user" ON "investment_accounts" ("user_id") WHERE "is_active"`,
    );
    await queryRunner.query(
      `CREATE TYPE "investment_transaction_type" AS ENUM('buy', 'sell', 'dividend', 'interest', 'deposit', 'withdrawal', 'fee', 'tax', 'split', 'transfer_in', 'transfer_out', 'currency_exchange')`,
    );
    await queryRunner.query(
      `CREATE TYPE "fx_rate_source" AS ENUM('manual', 'twelve_data', 'broker', 'assumed_one')`,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_transactions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "account_id" uuid NOT NULL, "connection_id" uuid, "type" "investment_transaction_type" NOT NULL, "instrument_id" uuid, "occurred_on" date NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE, "quantity" numeric(28,10), "price" numeric(24,10), "amount" numeric(20,6) NOT NULL DEFAULT '0', "fee" numeric(20,6) NOT NULL DEFAULT '0', "tax" numeric(20,6) NOT NULL DEFAULT '0', "currency" character(3) NOT NULL, "fx_rate" numeric(20,10) NOT NULL DEFAULT '1', "fx_rate_source" "fx_rate_source" NOT NULL DEFAULT 'assumed_one', "settlement_currency" character(3), "settlement_amount" numeric(20,6), "split_ratio_numerator" integer, "split_ratio_denominator" integer, "counterparty_account_id" uuid, "external_id" text, "dedupe_hash" character(64) NOT NULL, "occurrence_index" smallint NOT NULL DEFAULT '0', "import_batch_id" uuid, "notes" text, "raw" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "investment_transactions_settlement_check" CHECK ("type" <> 'currency_exchange' OR ("settlement_currency" IS NOT NULL AND "settlement_amount" IS NOT NULL)), CONSTRAINT "investment_transactions_split_ratio_check" CHECK ("type" <> 'split' OR ("split_ratio_numerator" > 0 AND "split_ratio_denominator" > 0)), CONSTRAINT "investment_transactions_instrument_required" CHECK ("type" NOT IN ('buy', 'sell', 'split', 'transfer_in', 'transfer_out') OR "instrument_id" IS NOT NULL), CONSTRAINT "investment_transactions_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0), CONSTRAINT "investment_transactions_tax_check" CHECK ("tax" >= 0), CONSTRAINT "investment_transactions_fee_check" CHECK ("fee" >= 0), CONSTRAINT "investment_transactions_amount_check" CHECK ("amount" >= 0), CONSTRAINT "PK_4f1f10cd2594cd595d676d7e136" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_investment_transactions_external" ON "investment_transactions" ("connection_id", "external_id") WHERE "external_id" IS NOT NULL AND "connection_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_investment_transactions_dedupe" ON "investment_transactions" ("user_id", "dedupe_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_transactions_instrument" ON "investment_transactions" ("user_id", "instrument_id", "occurred_on") WHERE "instrument_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_transactions_account" ON "investment_transactions" ("account_id", "occurred_on") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_transactions_user_date" ON "investment_transactions" ("user_id", "occurred_on") `,
    );
    await queryRunner.query(
      `CREATE TYPE "realization_disposition" AS ENUM('sale', 'transfer_out')`,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_realizations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "account_id" uuid NOT NULL, "instrument_id" uuid NOT NULL, "sell_transaction_id" uuid, "lot_id" uuid, "quantity" numeric(28,10) NOT NULL, "proceeds_per_unit" numeric(24,10) NOT NULL, "cost_per_unit" numeric(24,10) NOT NULL, "realized_pnl" numeric(20,6) NOT NULL, "realized_pnl_base" numeric(20,6) NOT NULL, "currency" character(3) NOT NULL, "realized_on" date NOT NULL, "disposition" "realization_disposition" NOT NULL DEFAULT 'sale', "cost_basis_is_estimated" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d00f6b7bf40ca2d902658578a58" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_realizations_instrument" ON "investment_realizations" ("user_id", "instrument_id", "realized_on") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_realizations_user_date" ON "investment_realizations" ("user_id", "realized_on") `,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_positions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "account_id" uuid NOT NULL, "instrument_id" uuid NOT NULL, "quantity" numeric(28,10) NOT NULL DEFAULT '0', "average_cost" numeric(24,10) NOT NULL DEFAULT '0', "cost_basis" numeric(20,6) NOT NULL DEFAULT '0', "cost_basis_base" numeric(20,6) NOT NULL DEFAULT '0', "currency" character(3) NOT NULL, "realized_pnl_to_date_base" numeric(20,6) NOT NULL DEFAULT '0', "cost_basis_is_estimated" boolean NOT NULL DEFAULT false, "last_transaction_on" date, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_525fb32348b0cfe8ed03553e471" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_positions_user" ON "investment_positions" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_investment_positions" ON "investment_positions" ("account_id", "instrument_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_lots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "account_id" uuid NOT NULL, "instrument_id" uuid NOT NULL, "open_transaction_id" uuid, "opened_on" date NOT NULL, "quantity_original" numeric(28,10) NOT NULL, "quantity_open" numeric(28,10) NOT NULL, "cost_per_unit" numeric(24,10) NOT NULL, "currency" character(3) NOT NULL, "cost_per_unit_base" numeric(24,10) NOT NULL, "cost_basis_is_estimated" boolean NOT NULL DEFAULT false, "closed_on" date, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9b94354fe413f4dd99d5c675390" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_lots_remaining" ON "investment_lots" ("account_id", "instrument_id") WHERE "quantity_open" > 0`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_investment_lots_open" ON "investment_lots" ("user_id", "instrument_id", "account_id", "opened_on") `,
    );
    await queryRunner.query(
      `CREATE TABLE "investment_cash_balances" ("account_id" uuid NOT NULL, "currency" character(3) NOT NULL, "amount" numeric(20,6) NOT NULL DEFAULT '0', CONSTRAINT "PK_b9ee4637ce2dc467eb2957df13c" PRIMARY KEY ("account_id", "currency"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_accounts" ADD CONSTRAINT "FK_0734276f87c4efab6c41611cb76" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" ADD CONSTRAINT "FK_647c3d67b6e10b5ed3efe13a889" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" ADD CONSTRAINT "FK_2225e69afed9b28eb74d698742e" FOREIGN KEY ("account_id") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" ADD CONSTRAINT "FK_07b6ee1e3f1a70d851cdeecfc8f" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_realizations" ADD CONSTRAINT "FK_70f8f27712ac318dc6788202e6f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_realizations" ADD CONSTRAINT "FK_0f885f11aa78037365aaf024c1b" FOREIGN KEY ("account_id") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" ADD CONSTRAINT "FK_d4b3da83d51b2817a554483ce1f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" ADD CONSTRAINT "FK_ce207951b62bcb8150c302110c3" FOREIGN KEY ("account_id") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" ADD CONSTRAINT "FK_0e3eb30fac5d7a0661cd4061611" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_lots" ADD CONSTRAINT "FK_d7cb259536b6a7190e282c3c37f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_lots" ADD CONSTRAINT "FK_e735aa2b1b4cd09cf95a4fb93c0" FOREIGN KEY ("account_id") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_lots" ADD CONSTRAINT "FK_8726cc31acac30e0c54b6e54bdc" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investment_lots" DROP CONSTRAINT "FK_8726cc31acac30e0c54b6e54bdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_lots" DROP CONSTRAINT "FK_e735aa2b1b4cd09cf95a4fb93c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_lots" DROP CONSTRAINT "FK_d7cb259536b6a7190e282c3c37f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" DROP CONSTRAINT "FK_0e3eb30fac5d7a0661cd4061611"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" DROP CONSTRAINT "FK_ce207951b62bcb8150c302110c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_positions" DROP CONSTRAINT "FK_d4b3da83d51b2817a554483ce1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_realizations" DROP CONSTRAINT "FK_0f885f11aa78037365aaf024c1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_realizations" DROP CONSTRAINT "FK_70f8f27712ac318dc6788202e6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" DROP CONSTRAINT "FK_07b6ee1e3f1a70d851cdeecfc8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" DROP CONSTRAINT "FK_2225e69afed9b28eb74d698742e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_transactions" DROP CONSTRAINT "FK_647c3d67b6e10b5ed3efe13a889"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investment_accounts" DROP CONSTRAINT "FK_0734276f87c4efab6c41611cb76"`,
    );
    await queryRunner.query(`DROP TABLE "investment_cash_balances"`);
    await queryRunner.query(`DROP INDEX "idx_investment_lots_open"`);
    await queryRunner.query(`DROP INDEX "idx_investment_lots_remaining"`);
    await queryRunner.query(`DROP TABLE "investment_lots"`);
    await queryRunner.query(`DROP INDEX "uq_investment_positions"`);
    await queryRunner.query(`DROP INDEX "idx_investment_positions_user"`);
    await queryRunner.query(`DROP TABLE "investment_positions"`);
    await queryRunner.query(
      `DROP INDEX "idx_investment_realizations_user_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_investment_realizations_instrument"`,
    );
    await queryRunner.query(`DROP TABLE "investment_realizations"`);
    await queryRunner.query(`DROP TYPE "realization_disposition"`);
    await queryRunner.query(
      `DROP INDEX "idx_investment_transactions_user_date"`,
    );
    await queryRunner.query(`DROP INDEX "idx_investment_transactions_account"`);
    await queryRunner.query(
      `DROP INDEX "idx_investment_transactions_instrument"`,
    );
    await queryRunner.query(`DROP INDEX "uq_investment_transactions_dedupe"`);
    await queryRunner.query(`DROP INDEX "uq_investment_transactions_external"`);
    await queryRunner.query(`DROP TABLE "investment_transactions"`);
    await queryRunner.query(`DROP TYPE "fx_rate_source"`);
    await queryRunner.query(`DROP TYPE "investment_transaction_type"`);
    await queryRunner.query(`DROP INDEX "idx_investment_accounts_user"`);
    await queryRunner.query(`DROP INDEX "idx_investment_accounts_external"`);
    await queryRunner.query(`DROP TABLE "investment_accounts"`);
    await queryRunner.query(`DROP TYPE "broker_kind"`);
    await queryRunner.query(`DROP TABLE "instrument_prices"`);
    await queryRunner.query(`DROP TYPE "instrument_price_source"`);
    await queryRunner.query(`DROP INDEX "idx_instruments_isin"`);
    await queryRunner.query(`DROP INDEX "idx_instruments_benchmark"`);
    await queryRunner.query(`DROP INDEX "idx_instruments_needs_price"`);
    await queryRunner.query(`DROP TABLE "instruments"`);
    await queryRunner.query(`DROP TYPE "benchmark_key"`);
    await queryRunner.query(`DROP TYPE "instrument_asset_class"`);
  }
}

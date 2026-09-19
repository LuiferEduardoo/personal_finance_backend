import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketDataAndSnapshots1789795417597 implements MigrationInterface {
  name = 'MarketDataAndSnapshots1789795417597';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "market_data_usage" ("provider" text NOT NULL, "window_minute" TIMESTAMP WITH TIME ZONE NOT NULL, "credits" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_484dfadc5d521d994b00746926c" PRIMARY KEY ("provider", "window_minute"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "fx_rates" ("base_currency" character(3) NOT NULL, "quote_currency" character(3) NOT NULL, "rate_on" date NOT NULL, "rate" numeric(20,10) NOT NULL, "source" "instrument_price_source" NOT NULL DEFAULT 'twelve_data', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ce1f9be933d46be7889e89f800d" PRIMARY KEY ("base_currency", "quote_currency", "rate_on"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "portfolio_snapshots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "account_id" uuid, "snapshot_on" date NOT NULL, "market_value_base" numeric(20,6) NOT NULL DEFAULT '0', "cash_base" numeric(20,6) NOT NULL DEFAULT '0', "cost_basis_base" numeric(20,6) NOT NULL DEFAULT '0', "contributions_to_date_base" numeric(20,6) NOT NULL DEFAULT '0', "net_flow_base" numeric(20,6) NOT NULL DEFAULT '0', "unrealized_pnl_base" numeric(20,6) NOT NULL DEFAULT '0', "realized_pnl_to_date_base" numeric(20,6) NOT NULL DEFAULT '0', "dividends_to_date_base" numeric(20,6) NOT NULL DEFAULT '0', "twr_factor" numeric(20,12) NOT NULL DEFAULT '1', "twr_index" numeric(20,12) NOT NULL DEFAULT '100', "is_estimated" boolean NOT NULL DEFAULT false, "missing_price_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_46c13ef40300b3a6d379488f53a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_portfolio_snapshots_account" ON "portfolio_snapshots" ("user_id", "account_id", "snapshot_on") WHERE "account_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_portfolio_snapshots_total" ON "portfolio_snapshots" ("user_id", "snapshot_on") WHERE "account_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "FK_47afc16c274cc3ee2a05136b6d5" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Los benchmarks son instrumentos normales con benchmark_key: reutilizan el
    // caché de precios, el job nocturno y el limitador, sin maquinaria aparte.
    //
    // Se usan ETF como proxy y no los índices en crudo por dos razones: los
    // símbolos de índice no están en la mayoría de planes de Twelve Data, y el
    // nivel del índice excluye dividendos mientras que el TWR del usuario los
    // incluye, así que un ETF es la comparación honesta.
    await queryRunner.query(`
      INSERT INTO "instruments"
        ("symbol", "exchange", "name", "asset_class", "currency", "country",
         "twelve_data_symbol", "price_source", "needs_daily_price", "benchmark_key")
      VALUES
        ('SPY',  'NYSE',   'SPDR S&P 500 ETF Trust',        'etf', 'USD', 'US', 'SPY',  'twelve_data', true, 'sp500'),
        ('QQQ',  'NASDAQ', 'Invesco QQQ Trust',             'etf', 'USD', 'US', 'QQQ',  'twelve_data', true, 'nasdaq100'),
        ('URTH', 'NYSE',   'iShares MSCI World ETF',        'etf', 'USD', 'US', 'URTH', 'twelve_data', true, 'msci_world')
      ON CONFLICT ("symbol", "exchange") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "instruments" WHERE "benchmark_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" DROP CONSTRAINT "FK_47afc16c274cc3ee2a05136b6d5"`,
    );
    await queryRunner.query(`DROP INDEX "uq_portfolio_snapshots_total"`);
    await queryRunner.query(`DROP INDEX "uq_portfolio_snapshots_account"`);
    await queryRunner.query(`DROP TABLE "portfolio_snapshots"`);
    await queryRunner.query(`DROP TABLE "fx_rates"`);
    await queryRunner.query(`DROP TABLE "market_data_usage"`);
  }
}

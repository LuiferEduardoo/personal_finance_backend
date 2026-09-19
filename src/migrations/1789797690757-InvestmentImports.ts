import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvestmentImports1789797690757 implements MigrationInterface {
  name = 'InvestmentImports1789797690757';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "instrument_symbol_aliases" ("source" text NOT NULL, "alias" text NOT NULL, "instrument_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_17121d1c090967c3b6086503da8" PRIMARY KEY ("source", "alias"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "import_source" AS ENUM('csv', 'xlsx', 'pdf', 'broker_sync')`,
    );
    await queryRunner.query(
      `CREATE TYPE "import_status" AS ENUM('parsed', 'committed', 'failed', 'discarded')`,
    );
    await queryRunner.query(
      `CREATE TABLE "import_batches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "connection_id" uuid, "account_id" uuid, "source" "import_source" NOT NULL, "status" "import_status" NOT NULL DEFAULT 'parsed', "broker" "broker_kind", "file_name" text, "file_data" bytea, "file_mime_type" text, "parser_profile" text, "column_mapping" jsonb, "draft" jsonb, "stats" jsonb, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6162597a2576c03e04bb2c1a2dd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_import_batches_user" ON "import_batches" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "import_batches" ADD CONSTRAINT "FK_b75a8496dcd95067be919bba660" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "import_batches" DROP CONSTRAINT "FK_b75a8496dcd95067be919bba660"`,
    );
    await queryRunner.query(`DROP INDEX "idx_import_batches_user"`);
    await queryRunner.query(`DROP TABLE "import_batches"`);
    await queryRunner.query(`DROP TYPE "import_status"`);
    await queryRunner.query(`DROP TYPE "import_source"`);
    await queryRunner.query(`DROP TABLE "instrument_symbol_aliases"`);
  }
}

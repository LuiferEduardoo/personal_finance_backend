import { MigrationInterface, QueryRunner } from 'typeorm';

export class BrokerConnections1789831230104 implements MigrationInterface {
  name = 'BrokerConnections1789831230104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "broker_connection_status" AS ENUM('active', 'error', 'needs_reauth', 'disabled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "broker_connections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "broker" "broker_kind" NOT NULL, "label" text NOT NULL, "is_demo" boolean NOT NULL DEFAULT false, "auto_sync" boolean NOT NULL DEFAULT true, "credentials_ciphertext" bytea, "credentials_iv" bytea, "credentials_tag" bytea, "credentials_key_version" smallint NOT NULL DEFAULT '1', "status" "broker_connection_status" NOT NULL DEFAULT 'active', "last_synced_at" TIMESTAMP WITH TIME ZONE, "last_sync_cursor" jsonb, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "broker_connections_label_unique" UNIQUE ("user_id", "broker", "label"), CONSTRAINT "PK_578f47634ad1846a74e96a2dd24" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "broker_connections" ADD CONSTRAINT "FK_ac8e6e2543a4b8be0bdf1798bd3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "broker_connections" DROP CONSTRAINT "FK_ac8e6e2543a4b8be0bdf1798bd3"`,
    );
    await queryRunner.query(`DROP TABLE "broker_connections"`);
    await queryRunner.query(`DROP TYPE "broker_connection_status"`);
  }
}

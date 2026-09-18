import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys1789684352900 implements MigrationInterface {
  name = 'ApiKeys1789684352900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "api_keys" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" text NOT NULL, "prefix" text NOT NULL, "key_hash" text NOT NULL, "scopes" text array NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_api_keys_prefix" ON "api_keys" ("prefix") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_user" ON "api_keys" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973"`,
    );
    await queryRunner.query(`DROP INDEX "idx_api_keys_user"`);
    await queryRunner.query(`DROP INDEX "idx_api_keys_prefix"`);
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}

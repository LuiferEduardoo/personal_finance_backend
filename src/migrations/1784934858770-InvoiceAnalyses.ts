import { MigrationInterface, QueryRunner } from "typeorm";

export class InvoiceAnalyses1784934858770 implements MigrationInterface {
    name = 'InvoiceAnalyses1784934858770'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "invoice_source" AS ENUM('image', 'text')`);
        await queryRunner.query(`CREATE TABLE "invoice_analyses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "source" "invoice_source" NOT NULL, "input_text" text, "image_data" bytea, "image_mime_type" text, "model" text NOT NULL, "result" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3f9d9e635e5868fd732c427de06" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_invoice_analyses_user_date" ON "invoice_analyses" ("user_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "invoice_analyses" ADD CONSTRAINT "FK_a7da47219be04662fd61942e2bc" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invoice_analyses" DROP CONSTRAINT "FK_a7da47219be04662fd61942e2bc"`);
        await queryRunner.query(`DROP INDEX "idx_invoice_analyses_user_date"`);
        await queryRunner.query(`DROP TABLE "invoice_analyses"`);
        await queryRunner.query(`DROP TYPE "invoice_source"`);
    }

}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class ArticleInvoiceName1792460000000 implements MigrationInterface {
  name = 'ArticleInvoiceName1792460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "articles" ADD "invoice_name" text`);
    await queryRunner.query(
      `CREATE INDEX "idx_articles_invoice_name" ON "articles" ("user_id", "invoice_name") WHERE "invoice_name" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_articles_invoice_name"`);
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "invoice_name"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class ArticlesAndExpenseArticleLink1784670870824 implements MigrationInterface {
    name = 'ArticlesAndExpenseArticleLink1784670870824'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "article_type" AS ENUM('product', 'service', 'other')`);
        await queryRunner.query(`CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "category_id" uuid, "name" text NOT NULL, "type" "article_type" NOT NULL DEFAULT 'product', "unit" "unit_of_measure" DEFAULT 'unit', "brand" text, "is_active" boolean NOT NULL DEFAULT true, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "articles_name_unique" UNIQUE ("user_id", "name", "type"), CONSTRAINT "PK_0a6e2c450d83e0b6052c2793334" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_articles_user" ON "articles" ("user_id") WHERE "is_active"`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD "article_id" uuid`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD "quantity" numeric(12,3) NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "article_id" uuid`);
        await queryRunner.query(`CREATE INDEX "idx_expenses_article" ON "expenses" ("article_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_products_article" ON "products" ("article_id") WHERE "article_id" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "articles" ADD CONSTRAINT "FK_87bb15395540ae06337a486a77a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "articles" ADD CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_9bc64250e32eb71316dd0cd8197" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_d2d8f967e0d5aa8a6807eae84a3" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_d2d8f967e0d5aa8a6807eae84a3"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_9bc64250e32eb71316dd0cd8197"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "FK_87bb15395540ae06337a486a77a"`);
        await queryRunner.query(`DROP INDEX "idx_products_article"`);
        await queryRunner.query(`DROP INDEX "idx_expenses_article"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "article_id"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "quantity"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "article_id"`);
        await queryRunner.query(`DROP INDEX "idx_articles_user"`);
        await queryRunner.query(`DROP TABLE "articles"`);
        await queryRunner.query(`DROP TYPE "article_type"`);
    }

}

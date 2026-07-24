import { MigrationInterface, QueryRunner } from "typeorm";

export class MergeProductIntoArticle1784675316453 implements MigrationInterface {
    name = 'MergeProductIntoArticle1784675316453'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","product_stats","public"]);
        await queryRunner.query(`DROP VIEW "product_stats"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" DROP CONSTRAINT "FK_20b439e0af1363a6a3f162fd6d0"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" DROP CONSTRAINT "FK_74bfd499553390b3fbe49a37d01"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769"`);
        await queryRunner.query(`DROP INDEX "idx_product_purchases_product"`);
        await queryRunner.query(`DROP INDEX "idx_cycles_product"`);
        await queryRunner.query(`DROP INDEX "idx_cycles_one_open"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" RENAME COLUMN "product_id" TO "article_id"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" RENAME COLUMN "product_id" TO "article_id"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" RENAME COLUMN "product_id" TO "article_id"`);
        // migración limpia: los product_id viejos no son article_id válidos; se vacían
        await queryRunner.query(`TRUNCATE "product_purchases", "consumption_cycles", "shopping_list_items" RESTART IDENTITY CASCADE`);
        // Product deja de existir (fusionada en Article)
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`ALTER TABLE "articles" ADD "package_size" numeric(12,3)`);
        await queryRunner.query(`ALTER TABLE "articles" ADD "barcode" text`);
        await queryRunner.query(`ALTER TABLE "articles" ADD "is_consumable" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`CREATE INDEX "idx_product_purchases_article" ON "product_purchases" ("article_id", "purchased_on") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_cycles_one_open" ON "consumption_cycles" ("article_id") WHERE "depleted_on" IS NULL`);
        await queryRunner.query(`CREATE INDEX "idx_cycles_article" ON "consumption_cycles" ("article_id", "started_on") `);
        await queryRunner.query(`CREATE INDEX "idx_articles_barcode" ON "articles" ("user_id", "barcode") WHERE "barcode" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "product_purchases" ADD CONSTRAINT "FK_8463758d89ed0deaa46ed155f92" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" ADD CONSTRAINT "FK_3cad6c6a281ce0b70533976ad0b" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_7e64bbc05d5611c1c7fd63eaba3" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE VIEW "product_stats" AS 
    SELECT
        a."id"                                   AS "article_id",
        a."user_id",
        a."name",
        COALESCE(c."closed_cycles", 0)           AS "closed_cycles",
        ROUND(c."avg_days_lasted", 1)            AS "avg_days_lasted",
        c."min_days_lasted",
        c."max_days_lasted",
        pp."last_purchased_on",
        ROUND(pp."avg_unit_price", 2)            AS "avg_unit_price",
        (c."open_started_on" + ROUND(c."avg_days_lasted")::INT)
                                                 AS "estimated_depletion_date"
    FROM "articles" a
    LEFT JOIN (
        SELECT "article_id",
               COUNT(*) FILTER (WHERE "depleted_on" IS NOT NULL) AS "closed_cycles",
               AVG("days_lasted")                                AS "avg_days_lasted",
               MIN("days_lasted")                                AS "min_days_lasted",
               MAX("days_lasted")                                AS "max_days_lasted",
               MAX("started_on") FILTER (WHERE "depleted_on" IS NULL) AS "open_started_on"
        FROM "consumption_cycles"
        GROUP BY "article_id"
    ) c ON c."article_id" = a."id"
    LEFT JOIN (
        SELECT "article_id",
               MAX("purchased_on") AS "last_purchased_on",
               AVG("unit_price")   AS "avg_unit_price"
        FROM "product_purchases"
        GROUP BY "article_id"
    ) pp ON pp."article_id" = a."id"
    WHERE a."type" = 'product'
  `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","product_stats","SELECT\n        a.\"id\"                                   AS \"article_id\",\n        a.\"user_id\",\n        a.\"name\",\n        COALESCE(c.\"closed_cycles\", 0)           AS \"closed_cycles\",\n        ROUND(c.\"avg_days_lasted\", 1)            AS \"avg_days_lasted\",\n        c.\"min_days_lasted\",\n        c.\"max_days_lasted\",\n        pp.\"last_purchased_on\",\n        ROUND(pp.\"avg_unit_price\", 2)            AS \"avg_unit_price\",\n        (c.\"open_started_on\" + ROUND(c.\"avg_days_lasted\")::INT)\n                                                 AS \"estimated_depletion_date\"\n    FROM \"articles\" a\n    LEFT JOIN (\n        SELECT \"article_id\",\n               COUNT(*) FILTER (WHERE \"depleted_on\" IS NOT NULL) AS \"closed_cycles\",\n               AVG(\"days_lasted\")                                AS \"avg_days_lasted\",\n               MIN(\"days_lasted\")                                AS \"min_days_lasted\",\n               MAX(\"days_lasted\")                                AS \"max_days_lasted\",\n               MAX(\"started_on\") FILTER (WHERE \"depleted_on\" IS NULL) AS \"open_started_on\"\n        FROM \"consumption_cycles\"\n        GROUP BY \"article_id\"\n    ) c ON c.\"article_id\" = a.\"id\"\n    LEFT JOIN (\n        SELECT \"article_id\",\n               MAX(\"purchased_on\") AS \"last_purchased_on\",\n               AVG(\"unit_price\")   AS \"avg_unit_price\"\n        FROM \"product_purchases\"\n        GROUP BY \"article_id\"\n    ) pp ON pp.\"article_id\" = a.\"id\"\n    WHERE a.\"type\" = 'product'"]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","product_stats","public"]);
        await queryRunner.query(`DROP VIEW "product_stats"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_7e64bbc05d5611c1c7fd63eaba3"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" DROP CONSTRAINT "FK_3cad6c6a281ce0b70533976ad0b"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" DROP CONSTRAINT "FK_8463758d89ed0deaa46ed155f92"`);
        await queryRunner.query(`DROP INDEX "idx_articles_barcode"`);
        await queryRunner.query(`DROP INDEX "idx_cycles_article"`);
        await queryRunner.query(`DROP INDEX "idx_cycles_one_open"`);
        await queryRunner.query(`DROP INDEX "idx_product_purchases_article"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "is_consumable"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "barcode"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "package_size"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" RENAME COLUMN "article_id" TO "product_id"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" RENAME COLUMN "article_id" TO "product_id"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" RENAME COLUMN "article_id" TO "product_id"`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "category_id" uuid, "article_id" uuid, "name" text NOT NULL, "brand" text, "package_size" numeric(12,3), "unit" "unit_of_measure" NOT NULL DEFAULT 'unit', "barcode" text, "is_consumable" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "products_name_unique" UNIQUE ("user_id", "name", "brand", "package_size", "unit"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_products_user" ON "products" ("user_id") WHERE "is_active"`);
        await queryRunner.query(`CREATE INDEX "idx_products_barcode" ON "products" ("user_id", "barcode") WHERE "barcode" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_products_article" ON "products" ("article_id") WHERE "article_id" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_176b502c5ebd6e72cafbd9d6f70" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_d2d8f967e0d5aa8a6807eae84a3" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_cycles_one_open" ON "consumption_cycles" ("product_id") WHERE (depleted_on IS NULL)`);
        await queryRunner.query(`CREATE INDEX "idx_cycles_product" ON "consumption_cycles" ("product_id", "started_on") `);
        await queryRunner.query(`CREATE INDEX "idx_product_purchases_product" ON "product_purchases" ("product_id", "purchased_on") `);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" ADD CONSTRAINT "FK_74bfd499553390b3fbe49a37d01" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_purchases" ADD CONSTRAINT "FK_20b439e0af1363a6a3f162fd6d0" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE VIEW "product_stats" AS SELECT
        p."id"                                   AS "product_id",
        p."user_id",
        p."name",
        COALESCE(c."closed_cycles", 0)           AS "closed_cycles",
        ROUND(c."avg_days_lasted", 1)            AS "avg_days_lasted",
        c."min_days_lasted",
        c."max_days_lasted",
        pp."last_purchased_on",
        ROUND(pp."avg_unit_price", 2)            AS "avg_unit_price",
        (c."open_started_on" + ROUND(c."avg_days_lasted")::INT)
                                                 AS "estimated_depletion_date"
    FROM "products" p
    LEFT JOIN (
        SELECT "product_id",
               COUNT(*) FILTER (WHERE "depleted_on" IS NOT NULL) AS "closed_cycles",
               AVG("days_lasted")                                AS "avg_days_lasted",
               MIN("days_lasted")                                AS "min_days_lasted",
               MAX("days_lasted")                                AS "max_days_lasted",
               MAX("started_on") FILTER (WHERE "depleted_on" IS NULL) AS "open_started_on"
        FROM "consumption_cycles"
        GROUP BY "product_id"
    ) c ON c."product_id" = p."id"
    LEFT JOIN (
        SELECT "product_id",
               MAX("purchased_on") AS "last_purchased_on",
               AVG("unit_price")   AS "avg_unit_price"
        FROM "product_purchases"
        GROUP BY "product_id"
    ) pp ON pp."product_id" = p."id"`);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","product_stats","SELECT\n        p.\"id\"                                   AS \"product_id\",\n        p.\"user_id\",\n        p.\"name\",\n        COALESCE(c.\"closed_cycles\", 0)           AS \"closed_cycles\",\n        ROUND(c.\"avg_days_lasted\", 1)            AS \"avg_days_lasted\",\n        c.\"min_days_lasted\",\n        c.\"max_days_lasted\",\n        pp.\"last_purchased_on\",\n        ROUND(pp.\"avg_unit_price\", 2)            AS \"avg_unit_price\",\n        (c.\"open_started_on\" + ROUND(c.\"avg_days_lasted\")::INT)\n                                                 AS \"estimated_depletion_date\"\n    FROM \"products\" p\n    LEFT JOIN (\n        SELECT \"product_id\",\n               COUNT(*) FILTER (WHERE \"depleted_on\" IS NOT NULL) AS \"closed_cycles\",\n               AVG(\"days_lasted\")                                AS \"avg_days_lasted\",\n               MIN(\"days_lasted\")                                AS \"min_days_lasted\",\n               MAX(\"days_lasted\")                                AS \"max_days_lasted\",\n               MAX(\"started_on\") FILTER (WHERE \"depleted_on\" IS NULL) AS \"open_started_on\"\n        FROM \"consumption_cycles\"\n        GROUP BY \"product_id\"\n    ) c ON c.\"product_id\" = p.\"id\"\n    LEFT JOIN (\n        SELECT \"product_id\",\n               MAX(\"purchased_on\") AS \"last_purchased_on\",\n               AVG(\"unit_price\")   AS \"avg_unit_price\"\n        FROM \"product_purchases\"\n        GROUP BY \"product_id\"\n    ) pp ON pp.\"product_id\" = p.\"id\""]);
    }

}

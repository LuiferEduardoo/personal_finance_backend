import { MigrationInterface, QueryRunner } from 'typeorm';

export class PurchaseDiscounts1789684352824 implements MigrationInterface {
  name = 'PurchaseDiscounts1789684352824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ database, schema }] = (await queryRunner.query(
      `SELECT current_database() AS "database", current_schema() AS "schema"`,
    )) as Array<{ database: string; schema: string }>;
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`,
      ['VIEW', 'product_stats', schema],
    );
    await queryRunner.query(`DROP VIEW "product_stats"`);
    await queryRunner.query(
      `ALTER TABLE "expense_items" ADD "discount" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" ADD "discount" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_expense_items" ADD "discount" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" DROP COLUMN "subtotal"`,
    );
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'subtotal', database, schema, 'expense_items'],
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" ADD "subtotal" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity" - "discount") STORED NOT NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        schema,
        'expense_items',
        'GENERATED_COLUMN',
        'subtotal',
        '"unit_price" * "quantity" - "discount"',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" DROP COLUMN "total_price"`,
    );
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      [
        'GENERATED_COLUMN',
        'total_price',
        database,
        schema,
        'product_purchases',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" ADD "total_price" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity" - "discount") STORED`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        schema,
        'product_purchases',
        'GENERATED_COLUMN',
        'total_price',
        '"unit_price" * "quantity" - "discount"',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_discount_check" CHECK ("discount" >= 0 AND "discount" <= "unit_price" * "quantity")`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" ADD CONSTRAINT "product_purchases_discount_check" CHECK ("discount" >= 0 AND ("unit_price" IS NULL OR "discount" <= "unit_price" * "quantity"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_expense_items" ADD CONSTRAINT "recurring_expense_items_discount_check" CHECK ("discount" >= 0 AND "discount" <= "unit_price" * "quantity")`,
    );
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
               AVG("total_price" / NULLIF("quantity", 0)) AS "avg_unit_price"
        FROM "product_purchases"
        GROUP BY "article_id"
    ) pp ON pp."article_id" = a."id"
    WHERE a."type" = 'product'
  `);
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`,
      [
        schema,
        'VIEW',
        'product_stats',
        'SELECT\n        a."id"                                   AS "article_id",\n        a."user_id",\n        a."name",\n        COALESCE(c."closed_cycles", 0)           AS "closed_cycles",\n        ROUND(c."avg_days_lasted", 1)            AS "avg_days_lasted",\n        c."min_days_lasted",\n        c."max_days_lasted",\n        pp."last_purchased_on",\n        ROUND(pp."avg_unit_price", 2)            AS "avg_unit_price",\n        (c."open_started_on" + ROUND(c."avg_days_lasted")::INT)\n                                                 AS "estimated_depletion_date"\n    FROM "articles" a\n    LEFT JOIN (\n        SELECT "article_id",\n               COUNT(*) FILTER (WHERE "depleted_on" IS NOT NULL) AS "closed_cycles",\n               AVG("days_lasted")                                AS "avg_days_lasted",\n               MIN("days_lasted")                                AS "min_days_lasted",\n               MAX("days_lasted")                                AS "max_days_lasted",\n               MAX("started_on") FILTER (WHERE "depleted_on" IS NULL) AS "open_started_on"\n        FROM "consumption_cycles"\n        GROUP BY "article_id"\n    ) c ON c."article_id" = a."id"\n    LEFT JOIN (\n        SELECT "article_id",\n               MAX("purchased_on") AS "last_purchased_on",\n               AVG("total_price" / NULLIF("quantity", 0)) AS "avg_unit_price"\n        FROM "product_purchases"\n        GROUP BY "article_id"\n    ) pp ON pp."article_id" = a."id"\n    WHERE a."type" = \'product\'',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ database, schema }] = (await queryRunner.query(
      `SELECT current_database() AS "database", current_schema() AS "schema"`,
    )) as Array<{ database: string; schema: string }>;
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`,
      ['VIEW', 'product_stats', schema],
    );
    await queryRunner.query(`DROP VIEW "product_stats"`);
    await queryRunner.query(
      `ALTER TABLE "recurring_expense_items" DROP CONSTRAINT "recurring_expense_items_discount_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" DROP CONSTRAINT "product_purchases_discount_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" DROP CONSTRAINT "expense_items_discount_check"`,
    );
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      [
        'GENERATED_COLUMN',
        'total_price',
        database,
        schema,
        'product_purchases',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" DROP COLUMN "total_price"`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        schema,
        'product_purchases',
        'GENERATED_COLUMN',
        'total_price',
        '"unit_price" * "quantity"',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" ADD "total_price" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity") STORED`,
    );
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'subtotal', database, schema, 'expense_items'],
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" DROP COLUMN "subtotal"`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        schema,
        'expense_items',
        'GENERATED_COLUMN',
        'subtotal',
        '"unit_price" * "quantity"',
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" ADD "subtotal" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity") STORED NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_expense_items" DROP COLUMN "discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_purchases" DROP COLUMN "discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_items" DROP COLUMN "discount"`,
    );
    await queryRunner.query(`CREATE VIEW "product_stats" AS SELECT
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
    WHERE a."type" = 'product'`);
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`,
      [
        schema,
        'VIEW',
        'product_stats',
        'SELECT\n        a."id"                                   AS "article_id",\n        a."user_id",\n        a."name",\n        COALESCE(c."closed_cycles", 0)           AS "closed_cycles",\n        ROUND(c."avg_days_lasted", 1)            AS "avg_days_lasted",\n        c."min_days_lasted",\n        c."max_days_lasted",\n        pp."last_purchased_on",\n        ROUND(pp."avg_unit_price", 2)            AS "avg_unit_price",\n        (c."open_started_on" + ROUND(c."avg_days_lasted")::INT)\n                                                 AS "estimated_depletion_date"\n    FROM "articles" a\n    LEFT JOIN (\n        SELECT "article_id",\n               COUNT(*) FILTER (WHERE "depleted_on" IS NOT NULL) AS "closed_cycles",\n               AVG("days_lasted")                                AS "avg_days_lasted",\n               MIN("days_lasted")                                AS "min_days_lasted",\n               MAX("days_lasted")                                AS "max_days_lasted",\n               MAX("started_on") FILTER (WHERE "depleted_on" IS NULL) AS "open_started_on"\n        FROM "consumption_cycles"\n        GROUP BY "article_id"\n    ) c ON c."article_id" = a."id"\n    LEFT JOIN (\n        SELECT "article_id",\n               MAX("purchased_on") AS "last_purchased_on",\n               AVG("unit_price")   AS "avg_unit_price"\n        FROM "product_purchases"\n        GROUP BY "article_id"\n    ) pp ON pp."article_id" = a."id"\n    WHERE a."type" = \'product\'',
      ],
    );
  }
}

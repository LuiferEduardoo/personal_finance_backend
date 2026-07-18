import { MigrationInterface, QueryRunner } from "typeorm";

export class ProductsSchema1784406766000 implements MigrationInterface {
    name = 'ProductsSchema1784406766000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."unit_of_measure" AS ENUM('unit', 'g', 'kg', 'ml', 'l', 'pack', 'roll', 'pair', 'other')`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "category_id" uuid, "name" text NOT NULL, "brand" text, "package_size" numeric(12,3), "unit" "public"."unit_of_measure" NOT NULL DEFAULT 'unit', "barcode" text, "is_consumable" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "products_name_unique" UNIQUE ("user_id", "name", "brand", "package_size", "unit"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_products_barcode" ON "products" ("user_id", "barcode") WHERE "barcode" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "idx_products_user" ON "products" ("user_id") WHERE "is_active"`);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["personal_finance","public","product_purchases","GENERATED_COLUMN","total_price","\"unit_price\" * \"quantity\""]);
        await queryRunner.query(`CREATE TABLE "product_purchases" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "product_id" uuid NOT NULL, "expense_id" uuid, "quantity" numeric(12,3) NOT NULL DEFAULT '1', "unit_price" numeric(14,2), "total_price" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity") STORED, "store" text, "purchased_on" date NOT NULL, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "product_purchases_unit_price_check" CHECK ("unit_price" IS NULL OR "unit_price" >= 0), CONSTRAINT "product_purchases_quantity_check" CHECK ("quantity" > 0), CONSTRAINT "PK_f28cf8bf29b23ab794dfc91f45c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_product_purchases_expense" ON "product_purchases" ("expense_id") `);
        await queryRunner.query(`CREATE INDEX "idx_product_purchases_product" ON "product_purchases" ("product_id", "purchased_on") `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["personal_finance","public","consumption_cycles","GENERATED_COLUMN","days_lasted","\"depleted_on\" - \"started_on\""]);
        await queryRunner.query(`CREATE TABLE "consumption_cycles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "product_id" uuid NOT NULL, "purchase_id" uuid, "started_on" date NOT NULL, "depleted_on" date, "days_lasted" integer GENERATED ALWAYS AS ("depleted_on" - "started_on") STORED, "quantity" numeric(12,3) NOT NULL DEFAULT '1', "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "consumption_cycles_quantity_check" CHECK ("quantity" > 0), CONSTRAINT "cycles_date_order" CHECK ("depleted_on" IS NULL OR "depleted_on" >= "started_on"), CONSTRAINT "PK_9deba3747f96ff8415c24c4767b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_cycles_one_open" ON "consumption_cycles" ("product_id") WHERE "depleted_on" IS NULL`);
        await queryRunner.query(`CREATE INDEX "idx_cycles_product" ON "consumption_cycles" ("product_id", "started_on") `);
        await queryRunner.query(`CREATE TYPE "public"."list_item_status" AS ENUM('pending', 'purchased', 'skipped')`);
        await queryRunner.query(`CREATE TABLE "shopping_list_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "list_id" uuid NOT NULL, "product_id" uuid, "free_text" text, "quantity" numeric(12,3) NOT NULL DEFAULT '1', "status" "public"."list_item_status" NOT NULL DEFAULT 'pending', "auto_added" boolean NOT NULL DEFAULT false, "product_purchase_id" uuid, "position" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "shopping_list_items_quantity_check" CHECK ("quantity" > 0), CONSTRAINT "list_item_has_ref" CHECK ("product_id" IS NOT NULL OR "free_text" IS NOT NULL), CONSTRAINT "PK_043c112c02fdc1c39fbd619fadb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_list_items_pending" ON "shopping_list_items" ("list_id", "position") WHERE "status" = 'pending'`);
        await queryRunner.query(`CREATE TABLE "shopping_lists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" text NOT NULL DEFAULT 'Shopping list', "is_archived" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9289ace7dd5e768d65290f3f9de" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_176b502c5ebd6e72cafbd9d6f70" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_purchases" ADD CONSTRAINT "FK_492098c5561b1fe02a7b98b2d42" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_purchases" ADD CONSTRAINT "FK_20b439e0af1363a6a3f162fd6d0" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_purchases" ADD CONSTRAINT "FK_04aea9fedf6197320f5d7bdc1a1" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" ADD CONSTRAINT "FK_5bf4a68ef7b1d77613d6c26cdba" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" ADD CONSTRAINT "FK_74bfd499553390b3fbe49a37d01" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" ADD CONSTRAINT "FK_0d0c1dd18ba8efe8a098732f106" FOREIGN KEY ("purchase_id") REFERENCES "product_purchases"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_caeede64de0c13c6dd9d3d945cc" FOREIGN KEY ("list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_c9f2dff79693c29a27f3bd2eb20" FOREIGN KEY ("product_purchase_id") REFERENCES "product_purchases"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shopping_lists" ADD CONSTRAINT "FK_1851ac0f1c24464395dbb4df7b7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE VIEW "product_stats" AS 
    SELECT
        p."id"                                        AS "product_id",
        p."user_id",
        p."name",
        COUNT(c."id") FILTER (WHERE c."depleted_on" IS NOT NULL) AS "closed_cycles",
        ROUND(AVG(c."days_lasted"), 1)                AS "avg_days_lasted",
        MIN(c."days_lasted")                          AS "min_days_lasted",
        MAX(c."days_lasted")                          AS "max_days_lasted",
        MAX(pp."purchased_on")                        AS "last_purchased_on",
        ROUND(AVG(pp."unit_price"), 2)                AS "avg_unit_price",
        (MAX(c."started_on") FILTER (WHERE c."depleted_on" IS NULL)
            + (AVG(c."days_lasted"))::INT)            AS "estimated_depletion_date"
    FROM "products" p
    LEFT JOIN "consumption_cycles" c ON c."product_id" = p."id"
    LEFT JOIN "product_purchases" pp ON pp."product_id" = p."id"
    GROUP BY p."id"
  `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","product_stats","SELECT\n        p.\"id\"                                        AS \"product_id\",\n        p.\"user_id\",\n        p.\"name\",\n        COUNT(c.\"id\") FILTER (WHERE c.\"depleted_on\" IS NOT NULL) AS \"closed_cycles\",\n        ROUND(AVG(c.\"days_lasted\"), 1)                AS \"avg_days_lasted\",\n        MIN(c.\"days_lasted\")                          AS \"min_days_lasted\",\n        MAX(c.\"days_lasted\")                          AS \"max_days_lasted\",\n        MAX(pp.\"purchased_on\")                        AS \"last_purchased_on\",\n        ROUND(AVG(pp.\"unit_price\"), 2)                AS \"avg_unit_price\",\n        (MAX(c.\"started_on\") FILTER (WHERE c.\"depleted_on\" IS NULL)\n            + (AVG(c.\"days_lasted\"))::INT)            AS \"estimated_depletion_date\"\n    FROM \"products\" p\n    LEFT JOIN \"consumption_cycles\" c ON c.\"product_id\" = p.\"id\"\n    LEFT JOIN \"product_purchases\" pp ON pp.\"product_id\" = p.\"id\"\n    GROUP BY p.\"id\""]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","product_stats","public"]);
        await queryRunner.query(`DROP VIEW "product_stats"`);
        await queryRunner.query(`ALTER TABLE "shopping_lists" DROP CONSTRAINT "FK_1851ac0f1c24464395dbb4df7b7"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_c9f2dff79693c29a27f3bd2eb20"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_caeede64de0c13c6dd9d3d945cc"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" DROP CONSTRAINT "FK_0d0c1dd18ba8efe8a098732f106"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" DROP CONSTRAINT "FK_74bfd499553390b3fbe49a37d01"`);
        await queryRunner.query(`ALTER TABLE "consumption_cycles" DROP CONSTRAINT "FK_5bf4a68ef7b1d77613d6c26cdba"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" DROP CONSTRAINT "FK_04aea9fedf6197320f5d7bdc1a1"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" DROP CONSTRAINT "FK_20b439e0af1363a6a3f162fd6d0"`);
        await queryRunner.query(`ALTER TABLE "product_purchases" DROP CONSTRAINT "FK_492098c5561b1fe02a7b98b2d42"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_176b502c5ebd6e72cafbd9d6f70"`);
        await queryRunner.query(`DROP TABLE "shopping_lists"`);
        await queryRunner.query(`DROP INDEX "public"."idx_list_items_pending"`);
        await queryRunner.query(`DROP TABLE "shopping_list_items"`);
        await queryRunner.query(`DROP TYPE "public"."list_item_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_cycles_product"`);
        await queryRunner.query(`DROP INDEX "public"."idx_cycles_one_open"`);
        await queryRunner.query(`DROP TABLE "consumption_cycles"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","days_lasted","personal_finance","public","consumption_cycles"]);
        await queryRunner.query(`DROP INDEX "public"."idx_product_purchases_product"`);
        await queryRunner.query(`DROP INDEX "public"."idx_product_purchases_expense"`);
        await queryRunner.query(`DROP TABLE "product_purchases"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","total_price","personal_finance","public","product_purchases"]);
        await queryRunner.query(`DROP INDEX "public"."idx_products_user"`);
        await queryRunner.query(`DROP INDEX "public"."idx_products_barcode"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TYPE "public"."unit_of_measure"`);
    }

}

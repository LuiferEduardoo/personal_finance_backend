import { MigrationInterface, QueryRunner } from "typeorm";

export class FixProductStatsView1784421964717 implements MigrationInterface {
    name = 'FixProductStatsView1784421964717'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","product_stats","public"]);
        await queryRunner.query(`DROP VIEW "product_stats"`);
        await queryRunner.query(`CREATE VIEW "product_stats" AS 
    SELECT
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
    ) pp ON pp."product_id" = p."id"
  `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","product_stats","SELECT\n        p.\"id\"                                   AS \"product_id\",\n        p.\"user_id\",\n        p.\"name\",\n        COALESCE(c.\"closed_cycles\", 0)           AS \"closed_cycles\",\n        ROUND(c.\"avg_days_lasted\", 1)            AS \"avg_days_lasted\",\n        c.\"min_days_lasted\",\n        c.\"max_days_lasted\",\n        pp.\"last_purchased_on\",\n        ROUND(pp.\"avg_unit_price\", 2)            AS \"avg_unit_price\",\n        (c.\"open_started_on\" + ROUND(c.\"avg_days_lasted\")::INT)\n                                                 AS \"estimated_depletion_date\"\n    FROM \"products\" p\n    LEFT JOIN (\n        SELECT \"product_id\",\n               COUNT(*) FILTER (WHERE \"depleted_on\" IS NOT NULL) AS \"closed_cycles\",\n               AVG(\"days_lasted\")                                AS \"avg_days_lasted\",\n               MIN(\"days_lasted\")                                AS \"min_days_lasted\",\n               MAX(\"days_lasted\")                                AS \"max_days_lasted\",\n               MAX(\"started_on\") FILTER (WHERE \"depleted_on\" IS NULL) AS \"open_started_on\"\n        FROM \"consumption_cycles\"\n        GROUP BY \"product_id\"\n    ) c ON c.\"product_id\" = p.\"id\"\n    LEFT JOIN (\n        SELECT \"product_id\",\n               MAX(\"purchased_on\") AS \"last_purchased_on\",\n               AVG(\"unit_price\")   AS \"avg_unit_price\"\n        FROM \"product_purchases\"\n        GROUP BY \"product_id\"\n    ) pp ON pp.\"product_id\" = p.\"id\""]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","product_stats","public"]);
        await queryRunner.query(`DROP VIEW "product_stats"`);
        await queryRunner.query(`CREATE VIEW "product_stats" AS SELECT
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
    GROUP BY p."id"`);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","product_stats","SELECT\n        p.\"id\"                                        AS \"product_id\",\n        p.\"user_id\",\n        p.\"name\",\n        COUNT(c.\"id\") FILTER (WHERE c.\"depleted_on\" IS NOT NULL) AS \"closed_cycles\",\n        ROUND(AVG(c.\"days_lasted\"), 1)                AS \"avg_days_lasted\",\n        MIN(c.\"days_lasted\")                          AS \"min_days_lasted\",\n        MAX(c.\"days_lasted\")                          AS \"max_days_lasted\",\n        MAX(pp.\"purchased_on\")                        AS \"last_purchased_on\",\n        ROUND(AVG(pp.\"unit_price\"), 2)                AS \"avg_unit_price\",\n        (MAX(c.\"started_on\") FILTER (WHERE c.\"depleted_on\" IS NULL)\n            + (AVG(c.\"days_lasted\"))::INT)            AS \"estimated_depletion_date\"\n    FROM \"products\" p\n    LEFT JOIN \"consumption_cycles\" c ON c.\"product_id\" = p.\"id\"\n    LEFT JOIN \"product_purchases\" pp ON pp.\"product_id\" = p.\"id\"\n    GROUP BY p.\"id\""]);
    }

}

import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { ValueTransformer, ViewColumn, ViewEntity } from 'typeorm';

// postgres devuelve las columnas date de la vista como Date; las exponemos como YYYY-MM-DD
const dateToString: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: Date | string | null): string | null => {
    if (!value) {
      return null;
    }
    return value instanceof Date ? value.toISOString().substring(0, 10) : value;
  },
};

// duración y costo promedio por artículo (tipo producto) + fecha estimada de
// agotamiento. Las agregaciones van en subconsultas por artículo para no
// multiplicar filas (ciclos x compras) en el join.
@ObjectType()
@ViewEntity({
  name: 'product_stats',
  expression: `
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
  `,
})
export class ProductStatsView {
  @Field(() => ID)
  @ViewColumn({ name: 'article_id' })
  articleId: string;

  @Field(() => ID)
  @ViewColumn({ name: 'user_id' })
  userId: string;

  @Field()
  @ViewColumn()
  name: string;

  @Field(() => Int)
  @ViewColumn({ name: 'closed_cycles' })
  closedCycles: string;

  @Field(() => Float, { nullable: true })
  @ViewColumn({ name: 'avg_days_lasted' })
  avgDaysLasted: string | null;

  @Field(() => Int, { nullable: true })
  @ViewColumn({ name: 'min_days_lasted' })
  minDaysLasted: number | null;

  @Field(() => Int, { nullable: true })
  @ViewColumn({ name: 'max_days_lasted' })
  maxDaysLasted: number | null;

  @Field(() => String, { nullable: true })
  @ViewColumn({ name: 'last_purchased_on', transformer: dateToString })
  lastPurchasedOn: string | null;

  @Field(() => Float, { nullable: true })
  @ViewColumn({ name: 'avg_unit_price' })
  avgUnitPrice: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Fecha estimada de agotamiento del ciclo abierto',
  })
  @ViewColumn({ name: 'estimated_depletion_date', transformer: dateToString })
  estimatedDepletionDate: string | null;
}

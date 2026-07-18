import { ViewColumn, ViewEntity } from 'typeorm';

// duración y costo promedio por producto + fecha estimada de agotamiento
@ViewEntity({
  name: 'product_stats',
  expression: `
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
  `,
})
export class ProductStatsView {
  @ViewColumn({ name: 'product_id' })
  productId: string;

  @ViewColumn({ name: 'user_id' })
  userId: string;

  @ViewColumn()
  name: string;

  @ViewColumn({ name: 'closed_cycles' })
  closedCycles: string;

  @ViewColumn({ name: 'avg_days_lasted' })
  avgDaysLasted: string | null;

  @ViewColumn({ name: 'min_days_lasted' })
  minDaysLasted: number | null;

  @ViewColumn({ name: 'max_days_lasted' })
  maxDaysLasted: number | null;

  @ViewColumn({ name: 'last_purchased_on' })
  lastPurchasedOn: string | null;

  @ViewColumn({ name: 'avg_unit_price' })
  avgUnitPrice: string | null;

  @ViewColumn({ name: 'estimated_depletion_date' })
  estimatedDepletionDate: string | null;
}

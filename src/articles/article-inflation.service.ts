import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '../transactions/entities/expense.entity';
import { ArticleInflationFilterInput } from './dto/article-inflation-filter.input';
import {
  ArticleInflationReport,
  ArticlePriceSeries,
  CategoryPriceSeries,
  InflationIndexPoint,
} from './dto/article-inflation.type';

interface PriceRow {
  article_id: string;
  article_name: string;
  category_id: string | null;
  category_parent_id: string | null;
  category_name: string | null;
  category_parent_name: string | null;
  period: string;
  total_base: string;
  total_qty: string;
}

interface ArticleAgg {
  articleId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryParentId: string | null;
  categoryParentName: string | null;
  // precio unitario y cantidad por mes
  byPeriod: Map<string, { price: number; qty: number }>;
}

const PERIOD_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class ArticleInflationService {
  constructor(
    // el repo de Expense se registra en ArticlesModule vía forFeature
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  /**
   * Inflación real: índice de precios de Laspeyres sobre los artículos
   * comprados (precio_unitario = amount / quantity). Solo cuenta el cambio
   * de precio, no el de cantidad. Distinto de expenseInflation.
   */
  async articleInflation(
    userId: string,
    filter?: ArticleInflationFilterInput,
  ): Promise<ArticleInflationReport> {
    this.validatePeriod(filter?.from, 'from');
    this.validatePeriod(filter?.to, 'to');

    // 12 meses extra antes del rango para poder comparar el primer mes
    const queryFrom = filter?.from ? this.shiftPeriod(filter.from, -12) : null;

    const rows: PriceRow[] = await this.expensesRepository.query(
      `
        SELECT e."article_id", a."name" AS article_name,
               a."category_id", cat."parent_id" AS category_parent_id,
               cat."name" AS category_name, catp."name" AS category_parent_name,
               to_char(date_trunc('month', e."occurred_on"), 'YYYY-MM') AS period,
               SUM(e."amount" * e."exchange_rate") AS total_base,
               SUM(e."quantity") AS total_qty
        FROM "expenses" e
        JOIN "articles" a ON a."id" = e."article_id"
        LEFT JOIN "categories" cat ON cat."id" = a."category_id"
        LEFT JOIN "categories" catp ON catp."id" = cat."parent_id"
        WHERE e."user_id" = $1 AND e."article_id" IS NOT NULL
          AND ($2::uuid IS NULL OR e."article_id" = $2::uuid)
          AND ($3::uuid IS NULL OR a."category_id" = $3::uuid OR cat."parent_id" = $3::uuid)
          AND ($4::text IS NULL OR a."type"::text = $4)
          AND ($5::text IS NULL OR e."occurred_on" >= to_date($5, 'YYYY-MM'))
          AND ($6::text IS NULL OR e."occurred_on" < to_date($6, 'YYYY-MM') + INTERVAL '1 month')
        GROUP BY e."article_id", a."name", a."category_id", cat."parent_id",
                 cat."name", catp."name", period
        ORDER BY period
      `,
      [
        userId,
        filter?.articleId ?? null,
        filter?.categoryId ?? null,
        filter?.type ?? null,
        queryFrom,
        filter?.to ?? null,
      ],
    );

    const articles = this.aggregateByArticle(rows);
    const allArticles = [...articles.values()];

    // meses a mostrar: los del rango pedido (los 12 extra solo sirven de base)
    const outputPeriods = [...new Set(rows.map((r) => r.period))]
      .filter((p) => !filter?.from || p >= filter.from)
      .sort();

    const points = this.laspeyresSeries(allArticles, outputPeriods);
    const monthlyRates = points
      .map((p) => p.monthlyRate)
      .filter((r): r is number => r !== null);
    const latest = points.at(-1);

    return {
      points,
      latestMonthlyRate: latest?.monthlyRate ?? null,
      latestAnnualRate: latest?.annualRate ?? null,
      averageMonthlyRate: monthlyRates.length
        ? this.round(
            monthlyRates.reduce((sum, r) => sum + r, 0) / monthlyRates.length,
          )
        : null,
      articles: this.buildArticleSeries(allArticles, filter?.from),
      categories: this.buildCategorySeries(allArticles, outputPeriods),
    };
  }

  private aggregateByArticle(rows: PriceRow[]): Map<string, ArticleAgg> {
    const articles = new Map<string, ArticleAgg>();
    for (const row of rows) {
      const qty = Number(row.total_qty);
      if (qty <= 0) {
        continue;
      }
      let agg = articles.get(row.article_id);
      if (!agg) {
        agg = {
          articleId: row.article_id,
          name: row.article_name,
          categoryId: row.category_id,
          categoryName: row.category_name,
          categoryParentId: row.category_parent_id,
          categoryParentName: row.category_parent_name,
          byPeriod: new Map(),
        };
        articles.set(row.article_id, agg);
      }
      agg.byPeriod.set(row.period, {
        price: Number(row.total_base) / qty,
        qty,
      });
    }
    return articles;
  }

  // índice de Laspeyres por mes sobre un conjunto de artículos
  private laspeyresSeries(
    articles: ArticleAgg[],
    periods: string[],
  ): InflationIndexPoint[] {
    return periods.map((period) => ({
      period,
      monthlyRate: this.laspeyresRate(
        articles,
        period,
        this.shiftPeriod(period, -1),
      ),
      annualRate: this.laspeyresRate(
        articles,
        period,
        this.shiftPeriod(period, -12),
      ),
      basketSize: articles.filter((a) => a.byPeriod.has(period)).length,
    }));
  }

  // Σ(precio_t · cantidad_base) / Σ(precio_base · cantidad_base) - 1
  private laspeyresRate(
    articles: ArticleAgg[],
    period: string,
    basePeriod: string,
  ): number | null {
    let num = 0;
    let den = 0;
    for (const article of articles) {
      const current = article.byPeriod.get(period);
      const base = article.byPeriod.get(basePeriod);
      if (current && base) {
        num += current.price * base.qty;
        den += base.price * base.qty;
      }
    }
    return den > 0 ? this.round((num / den - 1) * 100) : null;
  }

  private buildArticleSeries(
    articles: ArticleAgg[],
    from?: string,
  ): ArticlePriceSeries[] {
    return articles.map((article) => {
      const periods = [...article.byPeriod.keys()]
        .filter((p) => !from || p >= from)
        .sort();
      const points = periods.map((period) => {
        const data = article.byPeriod.get(period)!;
        return {
          period,
          avgUnitPrice: this.round(data.price),
          quantity: data.qty,
          monthlyRate: this.priceRate(article, period, -1),
          annualRate: this.priceRate(article, period, -12),
        };
      });
      const latest = points.at(-1);
      return {
        articleId: article.articleId,
        name: article.name,
        points,
        latestMonthlyRate: latest?.monthlyRate ?? null,
        latestAnnualRate: latest?.annualRate ?? null,
      };
    });
  }

  private priceRate(
    article: ArticleAgg,
    period: string,
    monthsBack: number,
  ): number | null {
    const current = article.byPeriod.get(period);
    const base = article.byPeriod.get(this.shiftPeriod(period, monthsBack));
    if (!current || !base || base.price === 0) {
      return null;
    }
    return this.round((current.price / base.price - 1) * 100);
  }

  // cada artículo aporta a su categoría y, con roll-up, a la categoría padre
  private buildCategorySeries(
    articles: ArticleAgg[],
    outputPeriods: string[],
  ): CategoryPriceSeries[] {
    const NONE = '__none__';
    const buckets = new Map<
      string,
      {
        categoryId: string | null;
        categoryName: string | null;
        items: ArticleAgg[];
      }
    >();

    const addTo = (
      key: string,
      categoryId: string | null,
      categoryName: string | null,
      article: ArticleAgg,
    ) => {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { categoryId, categoryName, items: [] };
        buckets.set(key, bucket);
      }
      bucket.items.push(article);
    };

    for (const article of articles) {
      addTo(
        article.categoryId ?? NONE,
        article.categoryId,
        article.categoryName,
        article,
      );
      if (article.categoryParentId) {
        addTo(
          article.categoryParentId,
          article.categoryParentId,
          article.categoryParentName,
          article,
        );
      }
    }

    return [...buckets.values()].map((bucket) => {
      const points = this.laspeyresSeries(bucket.items, outputPeriods);
      const latest = points.at(-1);
      return {
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        points,
        latestMonthlyRate: latest?.monthlyRate ?? null,
        latestAnnualRate: latest?.annualRate ?? null,
      };
    });
  }

  private shiftPeriod(period: string, months: number): string {
    const [year, month] = period.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
    return `${shifted.getUTCFullYear()}-${String(
      shifted.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private validatePeriod(period: string | undefined, field: string): void {
    if (period && !PERIOD_FORMAT.test(period)) {
      throw new BadRequestException(
        `El campo ${field} debe tener formato YYYY-MM`,
      );
    }
  }
}

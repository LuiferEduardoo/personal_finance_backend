import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InflationFilterInput } from './dto/inflation-filter.input';
import { InflationPoint, InflationReport } from './dto/inflation.type';
import { Expense } from './entities/expense.entity';

interface MonthlyTotalRow {
  period: string;
  total: string;
  count: string;
}

const PERIOD_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class InflationService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  /**
   * Inflación personal: variación del gasto mensual del usuario.
   * Los montos se llevan a la moneda base con exchange_rate.
   */
  async expenseInflation(
    userId: string,
    filter?: InflationFilterInput,
  ): Promise<InflationReport> {
    this.validatePeriod(filter?.from, 'from');
    this.validatePeriod(filter?.to, 'to');

    // se consultan 12 meses extra antes del rango pedido para poder calcular
    // las variaciones del primer mes de la ventana; luego se recortan
    const queryFrom = filter?.from ? this.shiftPeriod(filter.from, -12) : null;

    const rows: MonthlyTotalRow[] = await this.expensesRepository.query(
      `
        SELECT to_char(date_trunc('month', e."occurred_on"), 'YYYY-MM') AS period,
               SUM(e."amount" * e."exchange_rate") AS total,
               COUNT(*) AS count
        FROM "expenses" e
        LEFT JOIN "categories" c ON c."id" = e."category_id"
        WHERE e."user_id" = $1
          AND ($2::uuid IS NULL
               OR e."category_id" = $2::uuid
               OR c."parent_id" = $2::uuid)
          AND ($3::text IS NULL
               OR e."occurred_on" >= to_date($3, 'YYYY-MM'))
          AND ($4::text IS NULL
               OR e."occurred_on" < to_date($4, 'YYYY-MM') + INTERVAL '1 month')
        GROUP BY 1
        ORDER BY 1
      `,
      [userId, filter?.categoryId ?? null, queryFrom, filter?.to ?? null],
    );

    const totalsByPeriod = new Map(
      rows.map((row) => [row.period, Number(row.total)]),
    );

    const points: InflationPoint[] = rows
      .filter((row) => !filter?.from || row.period >= filter.from)
      .map((row) => {
        const total = Number(row.total);
        return {
          period: row.period,
          total,
          count: Number(row.count),
          monthlyRate: this.rateAgainst(
            total,
            totalsByPeriod.get(this.shiftPeriod(row.period, -1)),
          ),
          annualRate: this.rateAgainst(
            total,
            totalsByPeriod.get(this.shiftPeriod(row.period, -12)),
          ),
        };
      });

    const latest = points.at(-1);
    const monthlyRates = points
      .map((point) => point.monthlyRate)
      .filter((rate): rate is number => rate !== null);

    return {
      points,
      latestMonthlyRate: latest?.monthlyRate ?? null,
      latestAnnualRate: latest?.annualRate ?? null,
      averageMonthlyRate: monthlyRates.length
        ? this.round(
            monthlyRates.reduce((sum, rate) => sum + rate, 0) /
              monthlyRates.length,
          )
        : null,
    };
  }

  // null cuando no hay periodo de comparación con gasto registrado
  private rateAgainst(total: number, previous?: number): number | null {
    if (previous === undefined || previous === 0) {
      return null;
    }
    return this.round(((total - previous) / previous) * 100);
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

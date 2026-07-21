import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Gasto de un mes y su variación frente a periodos previos' })
export class InflationPoint {
  @Field({ description: 'Mes en formato YYYY-MM' })
  period: string;

  @Field(() => Float, {
    description: 'Total gastado en el mes, en la moneda base del usuario',
  })
  total: number;

  @Field(() => Int, { description: 'Cantidad de gastos registrados en el mes' })
  count: number;

  @Field(() => Float, {
    nullable: true,
    description:
      'Variación % frente al mes anterior. null si no hay mes previo con datos',
  })
  monthlyRate: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Variación % frente al mismo mes del año anterior. null si no hay dato',
  })
  annualRate: number | null;
}

@ObjectType({
  description:
    'Inflación personal calculada sobre los gastos registrados del usuario',
})
export class InflationReport {
  @Field(() => [InflationPoint], { description: 'Serie mensual ordenada' })
  points: InflationPoint[];

  @Field(() => Float, {
    nullable: true,
    description: 'Variación mensual del último periodo de la serie',
  })
  latestMonthlyRate: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Variación anual del último periodo de la serie',
  })
  latestAnnualRate: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Promedio de las variaciones mensuales de la serie (inflación mensual promedio)',
  })
  averageMonthlyRate: number | null;
}

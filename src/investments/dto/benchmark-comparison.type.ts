import { Field, Float, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AnnualizedStatus } from '../analytics/returns';

export enum BenchmarkBasis {
  /** Cierre ajustado: incluye dividendos, comparable con el TWR del usuario */
  TOTAL_RETURN = 'total_return',
  /** Solo precio: NO incluye dividendos del índice */
  PRICE_ONLY = 'price_only',
}

registerEnumType(BenchmarkBasis, {
  name: 'BenchmarkBasis',
  description: 'Si la serie del índice incluye dividendos o solo precio',
});

@ObjectType({ description: 'Un punto de una serie normalizada a base 100' })
export class ComparisonPoint {
  @Field()
  date: string;

  @Field(() => Float, {
    description: 'Índice normalizado a 100 en la fecha inicial',
  })
  index: number;
}

@ObjectType({ description: 'Una serie de la comparación' })
export class ComparisonSeries {
  @Field({ description: 'Identificador: "portfolio" o la clave del índice' })
  key: string;

  @Field()
  label: string;

  @Field(() => [ComparisonPoint])
  points: ComparisonPoint[];

  @Field(() => Float, {
    nullable: true,
    description: 'Rentabilidad del periodo en %',
  })
  totalReturn: number | null;

  @Field(() => Float, { nullable: true })
  annualized: number | null;

  @Field(() => AnnualizedStatus)
  annualizedStatus: AnnualizedStatus;

  @Field(() => Float, {
    nullable: true,
    description: 'Diferencia contra la cartera, en puntos porcentuales',
  })
  excessReturn: number | null;

  @Field(() => BenchmarkBasis, {
    description:
      'PRICE_ONLY significa que el índice va sin dividendos y la comparación le es desfavorable',
  })
  basis: BenchmarkBasis;
}

@ObjectType({ description: 'Cartera contra índices de referencia' })
export class BenchmarkComparison {
  @Field()
  baseCurrency: string;

  @Field()
  from: string;

  @Field()
  to: string;

  @Field({
    description:
      'true si las series de los índices se convirtieron a la moneda base del usuario',
  })
  inBaseCurrency: boolean;

  @Field(() => [ComparisonSeries], {
    description: 'La primera serie es siempre la cartera',
  })
  series: ComparisonSeries[];

  @Field(() => [String], {
    description: 'Índices pedidos que no se pudieron construir, y por qué',
  })
  warnings: string[];
}

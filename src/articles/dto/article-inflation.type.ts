import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description: 'Punto de un índice de precios (Laspeyres) en un mes',
})
export class InflationIndexPoint {
  @Field({ description: 'Mes YYYY-MM' })
  period: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Inflación % vs mes anterior (solo efecto precio)',
  })
  monthlyRate: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Inflación % vs mismo mes del año anterior',
  })
  annualRate: number | null;

  @Field(() => Int, {
    description: 'Nº de artículos comparables en el mes (canasta)',
  })
  basketSize: number;
}

@ObjectType({ description: 'Precio de un artículo en un mes y su variación' })
export class ArticlePricePoint {
  @Field()
  period: string;

  @Field(() => Float, { description: 'Precio unitario promedio del mes' })
  avgUnitPrice: number;

  @Field(() => Float, { description: 'Cantidad comprada en el mes' })
  quantity: number;

  @Field(() => Float, { nullable: true })
  monthlyRate: number | null;

  @Field(() => Float, { nullable: true })
  annualRate: number | null;
}

@ObjectType({ description: 'Serie de precios e inflación de un artículo' })
export class ArticlePriceSeries {
  @Field(() => ID)
  articleId: string;

  @Field()
  name: string;

  @Field(() => [ArticlePricePoint])
  points: ArticlePricePoint[];

  @Field(() => Float, { nullable: true })
  latestMonthlyRate: number | null;

  @Field(() => Float, { nullable: true })
  latestAnnualRate: number | null;
}

@ObjectType({ description: 'Índice de inflación de una categoría (roll-up)' })
export class CategoryPriceSeries {
  @Field(() => ID, { nullable: true })
  categoryId: string | null;

  @Field(() => String, { nullable: true })
  categoryName: string | null;

  @Field(() => [InflationIndexPoint])
  points: InflationIndexPoint[];

  @Field(() => Float, { nullable: true })
  latestMonthlyRate: number | null;

  @Field(() => Float, { nullable: true })
  latestAnnualRate: number | null;
}

@ObjectType({
  description:
    'Inflación real (índice de precios) sobre los artículos comprados. NO confundir con expenseInflation (variación de gasto).',
})
export class ArticleInflationReport {
  @Field(() => [InflationIndexPoint], {
    description: 'Índice agregado sobre todos los artículos',
  })
  points: InflationIndexPoint[];

  @Field(() => Float, { nullable: true })
  latestMonthlyRate: number | null;

  @Field(() => Float, { nullable: true })
  latestAnnualRate: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Promedio de las inflaciones mensuales del índice agregado',
  })
  averageMonthlyRate: number | null;

  @Field(() => [ArticlePriceSeries], { description: 'Desglose por artículo' })
  articles: ArticlePriceSeries[];

  @Field(() => [CategoryPriceSeries], { description: 'Desglose por categoría' })
  categories: CategoryPriceSeries[];
}

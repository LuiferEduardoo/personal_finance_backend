import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Un día de la evolución del patrimonio' })
export class PortfolioEvolutionPoint {
  @Field({ description: 'Fecha (YYYY-MM-DD)' })
  date: string;

  @Field(() => Float, { description: 'Valor total: posiciones más efectivo' })
  totalValue: number;

  @Field(() => Float)
  marketValue: number;

  @Field(() => Float)
  cash: number;

  @Field(() => Float)
  costBasis: number;

  @Field(() => Float, { description: 'Capital aportado acumulado' })
  contributions: number;

  @Field(() => Float, { description: 'Flujo externo neto del día' })
  netFlow: number;

  @Field(() => Float)
  unrealizedPnl: number;

  @Field(() => Float)
  realizedPnl: number;

  @Field(() => Float)
  dividends: number;

  @Field(() => Float, { description: 'Índice TWR encadenado, base 100' })
  twrIndex: number;

  @Field({ description: 'true si algún precio o tasa se arrastró' })
  isEstimated: boolean;

  @Field(() => Int)
  missingPriceCount: number;
}

@ObjectType({ description: 'Evolución histórica del patrimonio invertido' })
export class PortfolioEvolution {
  @Field()
  baseCurrency: string;

  @Field(() => [PortfolioEvolutionPoint])
  points: PortfolioEvolutionPoint[];

  @Field(() => Int, {
    description: 'Días cuya valoración usó precios o tasas arrastrados',
  })
  estimatedDays: number;
}

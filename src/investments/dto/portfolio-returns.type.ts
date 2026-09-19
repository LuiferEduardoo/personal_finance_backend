import { Field, Float, ObjectType } from '@nestjs/graphql';
import { AnnualizedStatus } from '../analytics/returns';
import { XirrStatus } from '../analytics/xirr';

@ObjectType({
  description:
    'Rentabilidad de la cartera por los tres métodos, que responden preguntas distintas',
})
export class PortfolioReturns {
  @Field()
  baseCurrency: string;

  @Field({ description: 'Inicio del periodo (YYYY-MM-DD)' })
  from: string;

  @Field({ description: 'Fin del periodo (YYYY-MM-DD)' })
  to: string;

  @Field(() => Float, {
    nullable: true,
    description:
      'Rentabilidad simple: (valor actual - capital aportado) / capital aportado',
  })
  simpleReturn: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'TWR del periodo en %. Neutraliza el momento de los aportes: mide cómo lo hicieron las inversiones',
  })
  twr: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'TWR anualizado. null por debajo de 365 días, a propósito',
  })
  twrAnnualized: number | null;

  @Field(() => AnnualizedStatus, {
    description: 'Por qué twrAnnualized es null, si lo es',
  })
  twrAnnualizedStatus: AnnualizedStatus;

  @Field(() => Float, {
    nullable: true,
    description:
      'XIRR / MWR en %. SÍ depende de cuándo metiste el dinero: es tu rentabilidad real',
  })
  xirr: number | null;

  @Field(() => XirrStatus, { description: 'Por qué xirr es null, si lo es' })
  xirrStatus: XirrStatus;

  @Field(() => Float, {
    description: 'Valor de la cartera al final del periodo',
  })
  endingValue: number;

  @Field(() => Float, { description: 'Capital aportado neto' })
  investedCapital: number;

  @Field(() => Float)
  realizedPnl: number;

  @Field(() => Float)
  unrealizedPnl: number;

  @Field(() => Float)
  dividends: number;

  @Field({
    description:
      'true si se escribieron operaciones después del último snapshot. ' +
      'Mientras sea true, el TWR y el XIRR van por detrás de portfolioSummary; ' +
      'ejecuta rebuildPortfolioSnapshots.',
  })
  isStale: boolean;
}

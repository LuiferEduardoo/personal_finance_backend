import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { CorporateActionType } from '../../market-data/entities/instrument-corporate-action.entity';

@ObjectType({
  description:
    'Acción corporativa que parece afectarte y que NO tienes registrada',
})
export class PendingCorporateAction {
  @Field(() => ID)
  id: string;

  @Field(() => CorporateActionType)
  type: CorporateActionType;

  @Field(() => ID)
  instrumentId: string;

  @Field()
  symbol: string;

  @Field()
  instrumentName: string;

  @Field({ description: 'Fecha ex-dividendo o de efecto del split' })
  exDate: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Dividendo por título anunciado',
  })
  amountPerShare: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Títulos que tenías en esa fecha, según tu libro',
  })
  quantityHeld: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Importe bruto estimado = títulos x dividendo por título',
  })
  estimatedAmount: number | null;

  @Field(() => Int, { nullable: true })
  ratioNumerator: number | null;

  @Field(() => Int, { nullable: true })
  ratioDenominator: number | null;

  @Field(() => String, { nullable: true })
  currency: string | null;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => [ID], {
    description: 'Cuentas donde tenías el activo en esa fecha',
  })
  accountIds: string[];
}

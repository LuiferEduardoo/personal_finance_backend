import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { CreateArticleInput } from '../../articles/dto/create-article.input';
import { Recurrence } from '../../common/enums/recurrence.enum';

@InputType()
export class CreateExpenseInput {
  // temporal: se reemplazará por el usuario del token JWT
  @Field(() => ID)
  userId: string;

  @Field()
  description: string;

  @Field(() => Float)
  amount: number;

  @Field(() => ID, {
    nullable: true,
    description: 'Artículo existente comprado en este gasto',
  })
  articleId?: string;

  @Field(() => CreateArticleInput, {
    nullable: true,
    description:
      'Crear el artículo (producto/servicio/otro) en el mismo gasto. Si es tipo producto, entra al inventario.',
  })
  newArticle?: CreateArticleInput;

  @Field(() => Float, {
    nullable: true,
    defaultValue: 1,
    description: 'Cantidad del artículo comprada',
  })
  quantity?: number;

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  exchangeRate?: number;

  @Field({ description: 'Fecha del gasto (YYYY-MM-DD)' })
  occurredOn: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field(() => ID, { nullable: true })
  paymentMethodId?: string;

  @Field({ nullable: true })
  merchant?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  receiptUrl?: string;

  @Field(() => Recurrence, {
    nullable: true,
    defaultValue: Recurrence.ONCE,
  })
  recurrence?: Recurrence;
}

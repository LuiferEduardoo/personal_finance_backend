import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { CreateArticleInput } from '../../articles/dto/create-article.input';

@InputType()
export class RegisterProductPurchaseInput {
  @Field(() => ID, {
    nullable: true,
    description: 'Artículo existente del catálogo',
  })
  articleId?: string;

  @Field(() => CreateArticleInput, {
    nullable: true,
    description:
      'Crear el artículo en el catálogo en la misma compra (si no existe aún)',
  })
  newArticle?: CreateArticleInput;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  quantity?: number;

  @Field(() => Float, { nullable: true })
  unitPrice?: number;

  @Field({ nullable: true })
  store?: string;

  @Field({ description: 'Fecha de compra (YYYY-MM-DD)' })
  purchasedOn: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Gasto asociado (ej. la ida al supermercado)',
  })
  expenseId?: string;

  @Field({ nullable: true })
  notes?: string;
}

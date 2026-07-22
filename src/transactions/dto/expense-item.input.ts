import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { CreateArticleInput } from '../../articles/dto/create-article.input';

@InputType()
export class ExpenseItemInput {
  @Field(() => ID, {
    nullable: true,
    description: 'Artículo existente del catálogo',
  })
  articleId?: string;

  @Field(() => CreateArticleInput, {
    nullable: true,
    description: 'Crear el artículo en la misma línea (si no existe aún)',
  })
  newArticle?: CreateArticleInput;

  @Field(() => Float, { description: 'Precio unitario del artículo' })
  unitPrice: number;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  quantity?: number;

  @Field({ nullable: true, description: 'Etiqueta libre de la línea' })
  description?: string;
}

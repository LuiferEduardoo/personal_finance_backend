import { Field, ID, InputType } from '@nestjs/graphql';
import { ArticleType } from '../entities/article.entity';

@InputType()
export class ArticleInflationFilterInput {
  @Field({ nullable: true, description: 'Mes inicial YYYY-MM (inclusive)' })
  from?: string;

  @Field({ nullable: true, description: 'Mes final YYYY-MM (inclusive)' })
  to?: string;

  @Field(() => ID, { nullable: true, description: 'Un solo artículo' })
  articleId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Una categoría (incluye subcategorías)',
  })
  categoryId?: string;

  @Field(() => ArticleType, { nullable: true })
  type?: ArticleType;
}

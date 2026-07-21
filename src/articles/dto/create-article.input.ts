import { Field, ID, InputType } from '@nestjs/graphql';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';
import { ArticleType } from '../entities/article.entity';

@InputType()
export class CreateArticleInput {
  @Field()
  name: string;

  @Field(() => ArticleType, {
    nullable: true,
    defaultValue: ArticleType.PRODUCT,
    description: 'producto / servicio / otro',
  })
  type?: ArticleType;

  @Field(() => UnitOfMeasure, {
    nullable: true,
    defaultValue: UnitOfMeasure.UNIT,
  })
  unit?: UnitOfMeasure;

  @Field({ nullable: true })
  brand?: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field({ nullable: true })
  notes?: string;
}

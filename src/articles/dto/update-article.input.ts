import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { CreateArticleInput } from './create-article.input';

@InputType()
export class UpdateArticleInput extends PartialType(CreateArticleInput, {
  omitDefaultValues: true,
}) {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

import { Field, ID, InputType } from '@nestjs/graphql';
import { TransactionKind } from '../../common/enums/transaction-kind.enum';

@InputType()
export class CreateCategoryInput {
  @Field()
  name: string;

  @Field(() => TransactionKind)
  kind: TransactionKind;

  @Field(() => ID, { nullable: true })
  parentId?: string;

  @Field({ nullable: true })
  icon?: string;

  @Field({ nullable: true })
  color?: string;
}

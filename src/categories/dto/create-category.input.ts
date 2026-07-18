import { Field, ID, InputType } from '@nestjs/graphql';
import { TransactionKind } from '../../common/enums/transaction-kind.enum';

@InputType()
export class CreateCategoryInput {
  // temporal: se reemplazará por el usuario del token JWT
  @Field(() => ID)
  userId: string;

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

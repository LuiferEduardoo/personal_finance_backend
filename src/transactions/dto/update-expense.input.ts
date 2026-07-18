import { Field, ID, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { CreateExpenseInput } from './create-expense.input';

@InputType()
export class UpdateExpenseInput extends PartialType(
  OmitType(CreateExpenseInput, ['userId'] as const),
) {
  @Field(() => ID)
  id: string;
}

import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { CreateRecurringExpenseInput } from './create-recurring-expense.input';

@InputType()
export class UpdateRecurringExpenseInput extends PartialType(
  CreateRecurringExpenseInput,
  { omitDefaultValues: true },
) {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

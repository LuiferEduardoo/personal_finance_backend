import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { CreateIncomeInput } from './create-income.input';

@InputType()
export class UpdateIncomeInput extends PartialType(CreateIncomeInput, {
  omitDefaultValues: true,
}) {
  @Field(() => ID)
  id: string;
}

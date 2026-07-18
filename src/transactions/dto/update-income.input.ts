import { Field, ID, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { CreateIncomeInput } from './create-income.input';

@InputType()
export class UpdateIncomeInput extends PartialType(
  OmitType(CreateIncomeInput, ['userId'] as const),
) {
  @Field(() => ID)
  id: string;
}

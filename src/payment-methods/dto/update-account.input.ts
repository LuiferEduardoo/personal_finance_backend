import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { CreateAccountInput } from './create-account.input';

@InputType()
export class UpdateAccountInput extends PartialType(CreateAccountInput, {
  omitDefaultValues: true,
}) {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

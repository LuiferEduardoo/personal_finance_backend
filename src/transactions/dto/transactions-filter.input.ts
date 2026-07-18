import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class TransactionsFilterInput {
  @Field({ nullable: true, description: 'Desde (YYYY-MM-DD), inclusive' })
  from?: string;

  @Field({ nullable: true, description: 'Hasta (YYYY-MM-DD), inclusive' })
  to?: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field(() => ID, { nullable: true })
  paymentMethodId?: string;
}

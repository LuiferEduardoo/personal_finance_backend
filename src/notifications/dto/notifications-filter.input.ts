import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class NotificationsFilterInput {
  @Field({ nullable: true, description: 'Solo las no leídas' })
  unreadOnly?: boolean;

  @Field(() => Int, {
    nullable: true,
    defaultValue: 20,
    description: 'Máximo 100',
  })
  limit?: number;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  offset?: number;
}

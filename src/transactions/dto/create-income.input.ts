import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { Recurrence } from '../../common/enums/recurrence.enum';

@InputType()
export class CreateIncomeInput {
  // temporal: se reemplazará por el usuario del token JWT
  @Field(() => ID)
  userId: string;

  @Field()
  description: string;

  @Field({ nullable: true })
  source?: string;

  @Field(() => Float)
  amount: number;

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  exchangeRate?: number;

  @Field({ description: 'Fecha del ingreso (YYYY-MM-DD)' })
  occurredOn: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta destino a la que entra el ingreso',
  })
  accountId?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => Recurrence, {
    nullable: true,
    defaultValue: Recurrence.ONCE,
  })
  recurrence?: Recurrence;
}

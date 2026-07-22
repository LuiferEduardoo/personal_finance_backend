import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { ExpenseItemInput } from '../../transactions/dto/expense-item.input';

@InputType()
export class CreateRecurringExpenseInput {
  @Field()
  description: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Importe fijo; requerido si no hay ítems',
  })
  amount?: number;

  @Field(() => [ExpenseItemInput], { nullable: true })
  items?: ExpenseItemInput[];

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  exchangeRate?: number;

  @Field(() => ID, { nullable: true })
  accountId?: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field({ nullable: true })
  merchant?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => Recurrence, { description: 'Frecuencia (no puede ser ONCE)' })
  recurrence: Recurrence;

  @Field({ description: 'Primera ocurrencia (YYYY-MM-DD)' })
  startOn: string;

  @Field({ nullable: true, description: 'Fecha límite (YYYY-MM-DD)' })
  endOn?: string;
}

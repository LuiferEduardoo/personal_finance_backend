import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { ExpenseItemInput } from './expense-item.input';

@InputType()
export class CreateExpenseInput {
  // temporal: se reemplazará por el usuario del token JWT
  @Field(() => ID)
  userId: string;

  @Field()
  description: string;

  @Field(() => Float, {
    nullable: true,
    description:
      'Requerido si el gasto no tiene ítems; si hay ítems se ignora y se calcula como la suma',
  })
  amount?: number;

  @Field(() => [ExpenseItemInput], {
    nullable: true,
    description:
      'Artículos comprados (opcional). El importe = suma de sus subtotales.',
  })
  items?: ExpenseItemInput[];

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  exchangeRate?: number;

  @Field({ description: 'Fecha del gasto (YYYY-MM-DD)' })
  occurredOn: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta de la que sale el gasto',
  })
  accountId?: string;

  @Field({ nullable: true })
  merchant?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  receiptUrl?: string;

  @Field(() => Recurrence, {
    nullable: true,
    defaultValue: Recurrence.ONCE,
  })
  recurrence?: Recurrence;
}

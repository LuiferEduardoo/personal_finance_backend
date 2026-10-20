import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { ExpenseItemInput } from './expense-item.input';

@InputType()
export class CreateExpenseInput {
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

  @Field(() => Int, {
    nullable: true,
    defaultValue: 1,
    description: 'Número de cuotas mensuales (entre 1 y 120)',
  })
  installmentCount?: number;

  @Field(() => Float, {
    nullable: true,
    defaultValue: 0,
    description:
      'Tasa de interés mensual en formato decimal (por ejemplo, 0.025 = 2.5%)',
  })
  monthlyInterestRate?: number;
}

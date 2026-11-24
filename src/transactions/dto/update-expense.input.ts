import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { CreateExpenseInput } from './create-expense.input';

// Sobre una cuota edita la compra a cuotas completa: `description` es la base
// (sin " (n/N)"), `amount`/`items` el capital, `occurredOn` la fecha de compra
// e `installmentCount`/`monthlyInterestRate` regeneran la tabla.
@InputType({
  description:
    'Sobre un gasto de una compra a cuotas edita la compra completa: description sin el sufijo (n/N), amount/items = capital, occurredOn = fecha de compra; installmentCount y monthlyInterestRate solo aplican a compras a cuotas',
})
export class UpdateExpenseInput extends PartialType(CreateExpenseInput, {
  omitDefaultValues: true,
}) {
  @Field(() => ID)
  id: string;
}

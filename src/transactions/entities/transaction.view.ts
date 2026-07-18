import { ViewColumn, ViewEntity } from 'typeorm';
import { TransactionKind } from '../../common/enums/transaction-kind.enum';

// vista de solo lectura que unifica gastos e ingresos para reportes/balance
@ViewEntity({
  name: 'transactions',
  expression: `
    SELECT "id", "user_id", "category_id", "payment_method_id", "occurred_on",
           'expense'::"transaction_kind" AS "kind",
           -"amount" AS "signed_amount", "amount", "currency", "description", "notes"
    FROM "expenses"
    UNION ALL
    SELECT "id", "user_id", "category_id", "payment_method_id", "occurred_on",
           'income'::"transaction_kind" AS "kind",
           "amount" AS "signed_amount", "amount", "currency", "description", "notes"
    FROM "incomes"
  `,
})
export class TransactionView {
  @ViewColumn()
  id: string;

  @ViewColumn({ name: 'user_id' })
  userId: string;

  @ViewColumn({ name: 'category_id' })
  categoryId: string | null;

  @ViewColumn({ name: 'payment_method_id' })
  paymentMethodId: string | null;

  @ViewColumn({ name: 'occurred_on' })
  occurredOn: string;

  @ViewColumn()
  kind: TransactionKind;

  @ViewColumn({ name: 'signed_amount' })
  signedAmount: string;

  @ViewColumn()
  amount: string;

  @ViewColumn()
  currency: string;

  @ViewColumn()
  description: string;

  @ViewColumn()
  notes: string | null;
}

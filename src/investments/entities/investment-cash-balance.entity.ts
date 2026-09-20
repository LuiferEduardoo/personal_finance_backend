import { Field, Float, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';

// Saldo en efectivo de una cuenta, por moneda. Una sola columna `balance` no
// sirve: la misma cuenta de bróker sostiene USD, EUR y USDT a la vez.
//
// Se mueve SOLO con .increment() dentro del EntityManager de quien llama,
// igual que PaymentMethodsService.adjustBalance, para no perder escrituras
// concurrentes.
@ObjectType()
@Entity('investment_cash_balances')
export class InvestmentCashBalance {
  @PrimaryColumn({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Field()
  @PrimaryColumn({ type: 'char', length: 3 })
  currency: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  amount: number;

  // Valor del saldo en la moneda base, acumulado con la tasa congelada de cada
  // movimiento. Convertir `amount` a posteriori con una sola tasa inventa
  // efectivo cuando el saldo se formó a tasas distintas.
  @Field(() => Float)
  @Column({
    name: 'amount_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  amountBase: number;
}

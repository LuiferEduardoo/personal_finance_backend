import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';

@InputType()
export class CreateInvestmentTransactionInput {
  @Field(() => ID)
  accountId: string;

  @Field(() => InvestmentTransactionType)
  type: InvestmentTransactionType;

  @Field(() => ID, {
    nullable: true,
    description: 'Obligatorio en BUY, SELL, SPLIT, TRANSFER_IN y TRANSFER_OUT',
  })
  instrumentId?: string;

  @Field({ description: 'Fecha de la operación (YYYY-MM-DD)' })
  occurredOn: string;

  @Field(() => Date, {
    nullable: true,
    description: 'Hora exacta; desempata el orden FIFO dentro del mismo día',
  })
  occurredAt?: Date;

  @Field(() => Float, { nullable: true, description: 'Siempre positiva' })
  quantity?: number;

  @Field(() => Float, { nullable: true, description: 'Precio unitario' })
  price?: number;

  @Field(() => Float, {
    nullable: true,
    description:
      'Importe bruto y positivo. Si se omite en una compra o venta se calcula como cantidad x precio',
  })
  amount?: number;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  fee?: number;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  tax?: number;

  @Field({ nullable: true, description: 'Moneda de la operación (ISO 4217)' })
  currency?: string;

  @Field(() => Float, {
    nullable: true,
    description:
      'Tasa de cambio a la moneda base del usuario. Si se omite, se calcula automáticamente.',
  })
  fxRate?: number;

  @Field({ nullable: true, description: 'Solo CURRENCY_EXCHANGE' })
  settlementCurrency?: string;

  @Field(() => Float, { nullable: true, description: 'Solo CURRENCY_EXCHANGE' })
  settlementAmount?: number;

  @Field(() => Int, {
    nullable: true,
    description: 'Solo SPLIT (ej. 2 en un 2:1)',
  })
  splitRatioNumerator?: number;

  @Field(() => Int, {
    nullable: true,
    description: 'Solo SPLIT (ej. 1 en un 2:1)',
  })
  splitRatioDenominator?: number;

  @Field(() => ID, {
    nullable: true,
    description:
      'Solo TRANSFER_OUT: cuenta destino. Los lotes se reabren allí conservando su base',
  })
  counterpartyAccountId?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => Int, {
    nullable: true,
    defaultValue: 0,
    description:
      'Solo para registrar a propósito dos operaciones idénticas el mismo día',
  })
  occurrenceIndex?: number;
}

@InputType()
export class UpdateInvestmentTransactionInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  occurredOn?: string;

  @Field(() => Date, { nullable: true })
  occurredAt?: Date;

  @Field(() => Float, { nullable: true })
  quantity?: number;

  @Field(() => Float, { nullable: true })
  price?: number;

  @Field(() => Float, { nullable: true })
  amount?: number;

  @Field(() => Float, { nullable: true })
  fee?: number;

  @Field(() => Float, { nullable: true })
  tax?: number;

  @Field(() => Float, { nullable: true })
  fxRate?: number;

  @Field(() => Int, { nullable: true })
  splitRatioNumerator?: number;

  @Field(() => Int, { nullable: true })
  splitRatioDenominator?: number;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class SetLotCostBasisInput {
  @Field(() => ID)
  lotId: string;

  @Field(() => Float, { description: 'Costo unitario real del lote' })
  costPerUnit: number;
}

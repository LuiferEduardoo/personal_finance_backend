import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { PaymentMethodType } from '../entities/payment-method.entity';

@InputType()
export class CreateAccountInput {
  @Field({ description: 'Nombre de la cuenta (ej. "Bancolombia", "Efectivo")' })
  name: string;

  @Field(() => PaymentMethodType)
  type: PaymentMethodType;

  @Field({ nullable: true })
  issuer?: string;

  @Field({ nullable: true })
  lastFour?: string;

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Solo tarjetas de crédito',
  })
  creditLimit?: number;

  @Field(() => Int, { nullable: true })
  statementDay?: number;

  @Field(() => Int, { nullable: true })
  dueDay?: number;

  @Field(() => Float, { nullable: true })
  monthlyRate?: number;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  openingBalance?: number;
}

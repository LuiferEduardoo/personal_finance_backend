import { Field, Float, ID, InputType } from '@nestjs/graphql';

@InputType()
export class TransferInput {
  @Field(() => ID, { description: 'Cuenta origen' })
  fromAccountId: string;

  @Field(() => ID, {
    description: 'Cuenta destino (si es de crédito, se paga la tarjeta)',
  })
  toAccountId: string;

  @Field(() => Float)
  amount: number;

  @Field({ nullable: true, description: 'Fecha (YYYY-MM-DD), por defecto hoy' })
  occurredOn?: string;

  @Field({ nullable: true })
  note?: string;
}

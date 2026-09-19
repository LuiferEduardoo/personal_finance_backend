import { Field, ID, InputType, PartialType } from '@nestjs/graphql';
import { BrokerKind } from '../../common/enums/broker-kind.enum';

@InputType()
export class CreateInvestmentAccountInput {
  @Field({ description: 'Nombre de la cuenta (ej. "IBKR Individual")' })
  name: string;

  @Field(() => BrokerKind, { nullable: true, defaultValue: BrokerKind.MANUAL })
  broker?: BrokerKind;

  @Field({
    nullable: true,
    defaultValue: 'USD',
    description: 'Moneda principal de la cuenta (ISO 4217)',
  })
  currency?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta de payment_methods asociada (reservado)',
  })
  linkedPaymentMethodId?: string;
}

@InputType()
export class UpdateInvestmentAccountInput extends PartialType(
  CreateInvestmentAccountInput,
) {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

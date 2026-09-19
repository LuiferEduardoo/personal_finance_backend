import { Field, ID, InputType, Int, registerEnumType } from '@nestjs/graphql';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';

// Tope de página. Un histórico de 5 años de IBKR + Binance pasa fácil de
// 20 000 filas: este es el único sitio del backend con paginación, y a
// propósito. El resto de listados están acotados por naturaleza.
export const MAX_TRANSACTIONS_LIMIT = 500;

@InputType()
export class InvestmentTransactionsFilterInput {
  @Field({ nullable: true, description: 'Desde (YYYY-MM-DD), inclusive' })
  from?: string;

  @Field({ nullable: true, description: 'Hasta (YYYY-MM-DD), inclusive' })
  to?: string;

  @Field(() => ID, { nullable: true })
  accountId?: string;

  @Field(() => ID, { nullable: true })
  instrumentId?: string;

  @Field(() => [InvestmentTransactionType], { nullable: true })
  types?: InvestmentTransactionType[];

  @Field(() => Int, {
    nullable: true,
    defaultValue: 100,
    description: `Máximo ${MAX_TRANSACTIONS_LIMIT}`,
  })
  limit?: number;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  offset?: number;
}

@InputType()
export class InvestmentPositionsFilterInput {
  @Field(() => ID, { nullable: true })
  accountId?: string;

  @Field(() => ID, { nullable: true })
  instrumentId?: string;

  @Field({
    nullable: true,
    defaultValue: false,
    description: 'Incluye posiciones cerradas (cantidad 0)',
  })
  includeClosed?: boolean;

  @Field({
    nullable: true,
    description: 'Valorar a esta fecha (YYYY-MM-DD). Por defecto, hoy',
  })
  asOf?: string;
}

export enum AllocationDimension {
  BROKER = 'broker',
  INSTRUMENT = 'instrument',
  SECTOR = 'sector',
  COUNTRY = 'country',
  CURRENCY = 'currency',
  ASSET_CLASS = 'asset_class',
}

registerEnumType(AllocationDimension, {
  name: 'AllocationDimension',
  description: 'Eje por el que repartir la cartera',
});

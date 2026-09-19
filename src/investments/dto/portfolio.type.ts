import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { Instrument } from '../../market-data/entities/instrument.entity';
import { InvestmentAccount } from '../entities/investment-account.entity';

@ObjectType({
  description: 'Posición viva valorada a precio de mercado',
})
export class PositionView {
  @Field(() => ID)
  id: string;

  @Field(() => InvestmentAccount)
  account: InvestmentAccount;

  @Field(() => Instrument)
  instrument: Instrument;

  @Field(() => Float)
  quantity: number;

  @Field(() => Float, { description: 'Costo promedio de los lotes abiertos' })
  averageCost: number;

  @Field(() => Float, { description: 'Base de costo en la moneda del activo' })
  costBasis: number;

  @Field(() => Float, { description: 'Base de costo en la moneda base' })
  costBasisBase: number;

  @Field()
  currency: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Último precio conocido. null si no hay precio disponible',
  })
  lastPrice: number | null;

  @Field(() => String, { nullable: true })
  lastPriceOn: string | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Valor de mercado en moneda base. null sin precio',
  })
  marketValueBase: number | null;

  @Field(() => Float, { nullable: true })
  unrealizedPnlBase: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Rentabilidad no realizada en %',
  })
  unrealizedReturn: number | null;

  @Field(() => Float)
  realizedPnlToDateBase: number;

  @Field({
    description:
      'true si la base de costo salió de un precio de mercado o quedó sin resolver',
  })
  costBasisIsEstimated: boolean;

  @Field({
    description: 'true si no hay ningún precio para valorar la posición',
  })
  priceMissing: boolean;
}

@ObjectType({ description: 'Saldo de efectivo de una cuenta, por moneda' })
export class CashBalanceView {
  @Field(() => ID)
  accountId: string;

  @Field()
  currency: string;

  @Field(() => Float)
  amount: number;
}

@ObjectType({
  description:
    'Resumen de la cartera a una fecha, en la moneda base del usuario',
})
export class PortfolioSummary {
  @Field({ description: 'Moneda base del usuario' })
  baseCurrency: string;

  @Field({ description: 'Fecha de valoración (YYYY-MM-DD)' })
  asOf: string;

  @Field(() => Float, {
    description: 'Capital aportado: depósitos menos retiros',
  })
  investedCapital: number;

  @Field(() => Float, {
    description:
      'Patrimonio invertido: base de costo de las posiciones abiertas',
  })
  costBasis: number;

  @Field(() => Float, {
    description: 'Valor actual: posiciones a precio de mercado más efectivo',
  })
  marketValue: number;

  @Field(() => Float, { description: 'Efectivo disponible en moneda base' })
  cash: number;

  @Field(() => Float, { description: 'Ganancia o pérdida NO realizada' })
  unrealizedPnl: number;

  @Field(() => Float, { description: 'Ganancia o pérdida REALIZADA acumulada' })
  realizedPnl: number;

  @Field(() => Float, {
    description: 'Dividendos recibidos, netos de retención',
  })
  dividends: number;

  @Field(() => Float, { description: 'Intereses recibidos, netos' })
  interest: number;

  @Field(() => Float, { description: 'Comisiones pagadas' })
  fees: number;

  @Field(() => Float, { description: 'Impuestos pagados' })
  taxes: number;

  @Field(() => Float, {
    nullable: true,
    description:
      'Rentabilidad simple en %: (valor actual - capital aportado) / capital aportado. null sin capital aportado',
  })
  simpleReturn: number | null;

  @Field(() => Int, { description: 'Posiciones abiertas' })
  positionsCount: number;

  @Field(() => Int, {
    description:
      'Posiciones sin precio: NO se valoran en 0, se excluyen y se cuentan aquí',
  })
  missingPriceCount: number;

  @Field(() => Int, {
    description: 'Posiciones cuya base de costo es una estimación',
  })
  estimatedBasisPositionsCount: number;

  @Field({
    description:
      'true si alguna posición se está valorando con un precio anterior a la fecha pedida',
  })
  pricesStale: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Precio más antiguo usado en la valoración',
  })
  pricesAsOf: string | null;
}

@ObjectType({ description: 'Reparto de la cartera por un eje' })
export class AllocationSlice {
  @Field({ description: 'Clave del grupo (ej. "NASDAQ", "Technology", "US")' })
  key: string;

  @Field({ description: 'Etiqueta legible del grupo' })
  label: string;

  @Field(() => Float, { description: 'Valor de mercado en moneda base' })
  marketValue: number;

  @Field(() => Float, { description: 'Base de costo en moneda base' })
  costBasis: number;

  @Field(() => Float, { description: 'Porcentaje sobre el total valorado' })
  percentage: number;

  @Field(() => Int)
  positionsCount: number;
}

@ObjectType({ description: 'Distribución de la cartera por un eje' })
export class PortfolioAllocation {
  @Field({ description: 'Fecha de valoración' })
  asOf: string;

  @Field({ description: 'Moneda base del usuario' })
  baseCurrency: string;

  @Field(() => Float, {
    description: 'Total valorado; excluye las posiciones sin precio',
  })
  total: number;

  @Field(() => [AllocationSlice])
  slices: AllocationSlice[];

  @Field(() => Int, {
    description: 'Posiciones excluidas por no tener precio',
  })
  missingPriceCount: number;
}

import { Field, ID, InputType } from '@nestjs/graphql';
import {
  BenchmarkKey,
  InstrumentAssetClass,
} from '../entities/instrument.entity';

@InputType()
export class CreateInstrumentInput {
  @Field({ description: 'Ticker (ej. "AAPL", "BTC/USD")' })
  symbol: string;

  @Field({ nullable: true, description: 'Bolsa (ej. "NASDAQ")' })
  exchange?: string;

  @Field({ nullable: true })
  micCode?: string;

  @Field({ description: 'Nombre del instrumento' })
  name: string;

  @Field(() => InstrumentAssetClass, {
    nullable: true,
    defaultValue: InstrumentAssetClass.EQUITY,
  })
  assetClass?: InstrumentAssetClass;

  @Field({ description: 'Moneda en la que cotiza (ISO 4217)' })
  currency: string;

  @Field({ nullable: true })
  sector?: string;

  @Field({ nullable: true })
  industry?: string;

  @Field({ nullable: true, description: 'Código ISO 3166-1 alfa-2' })
  country?: string;

  @Field({ nullable: true })
  isin?: string;

  @Field({ nullable: true, description: 'Símbolo a usar contra Twelve Data' })
  twelveDataSymbol?: string;

  @Field(() => BenchmarkKey, {
    nullable: true,
    description: 'Marca el instrumento como índice de referencia',
  })
  benchmarkKey?: BenchmarkKey;
}

@InputType()
export class UpdateInstrumentInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  sector?: string;

  @Field({ nullable: true })
  industry?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  isin?: string;

  @Field({ nullable: true })
  twelveDataSymbol?: string;
}

@InputType()
export class SetInstrumentPriceInput {
  @Field(() => ID)
  instrumentId: string;

  @Field({ description: 'Precio de cierre' })
  close: number;

  @Field({
    nullable: true,
    description: 'Fecha del precio (YYYY-MM-DD). Por defecto hoy',
  })
  priceOn?: string;
}

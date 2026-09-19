import {
  Field,
  Float,
  ID,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';

export enum InstrumentAssetClass {
  EQUITY = 'equity',
  ETF = 'etf',
  FUND = 'fund',
  BOND = 'bond',
  CRYPTO = 'crypto',
  FOREX = 'forex',
  COMMODITY = 'commodity',
  CFD = 'cfd',
  CASH = 'cash',
  OTHER = 'other',
}

registerEnumType(InstrumentAssetClass, {
  name: 'InstrumentAssetClass',
  description: 'Tipo de activo del instrumento',
});

export enum InstrumentPriceSource {
  TWELVE_DATA = 'twelve_data',
  MANUAL = 'manual',
  BROKER = 'broker',
  NONE = 'none',
}

registerEnumType(InstrumentPriceSource, {
  name: 'InstrumentPriceSource',
  description: 'De dónde salen los precios del instrumento',
});

export enum BenchmarkKey {
  SP500 = 'sp500',
  NASDAQ100 = 'nasdaq100',
  MSCI_WORLD = 'msci_world',
}

registerEnumType(BenchmarkKey, {
  name: 'BenchmarkKey',
  description: 'Índice de referencia contra el que comparar la cartera',
});

// Instrumento negociable (acción, ETF, cripto, etc.). Es dato de referencia
// GLOBAL: no lleva user_id a propósito, así el histórico de precios que
// descarga un usuario sirve para todos y el presupuesto de la API cunde.
@ObjectType()
@Entity('instruments')
@Unique('instruments_symbol_unique', ['symbol', 'exchange'])
@Index('idx_instruments_isin', ['isin'], { where: '"isin" IS NOT NULL' })
@Index('idx_instruments_benchmark', ['benchmarkKey'], {
  unique: true,
  where: '"benchmark_key" IS NOT NULL',
})
@Index('idx_instruments_needs_price', ['needsDailyPrice'], {
  where: '"needs_daily_price"',
})
export class Instrument {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field({ description: 'Ticker tal como lo usa el usuario (ej. "AAPL")' })
  @Column({ type: 'text' })
  symbol: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  exchange: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'mic_code', type: 'text', nullable: true })
  micCode: string | null;

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => InstrumentAssetClass)
  @Column({
    name: 'asset_class',
    type: 'enum',
    enum: InstrumentAssetClass,
    enumName: 'instrument_asset_class',
    default: InstrumentAssetClass.EQUITY,
  })
  assetClass: InstrumentAssetClass;

  @Field({ description: 'Moneda en la que cotiza' })
  @Column({ type: 'char', length: 3 })
  currency: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  sector: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  industry: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Código ISO 3166-1 alfa-2',
  })
  @Column({ type: 'char', length: 2, nullable: true })
  country: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  isin: string | null;

  // símbolo que se le manda a Twelve Data; puede diferir del que usa el bróker
  @Field(() => String, { nullable: true })
  @Column({ name: 'twelve_data_symbol', type: 'text', nullable: true })
  twelveDataSymbol: string | null;

  @Field(() => InstrumentPriceSource)
  @Column({
    name: 'price_source',
    type: 'enum',
    enum: InstrumentPriceSource,
    enumName: 'instrument_price_source',
    default: InstrumentPriceSource.MANUAL,
  })
  priceSource: InstrumentPriceSource;

  // bandera de racionamiento: solo los instrumentos que alguien tiene en
  // cartera hoy (más los benchmarks) se refrescan cada noche.
  @Field()
  @Column({ name: 'needs_daily_price', default: false })
  needsDailyPrice: boolean;

  // marca de histórico pendiente; la deja una posición nueva y la drena el job
  @Field(() => String, { nullable: true })
  @Column({ name: 'backfill_requested_from', type: 'date', nullable: true })
  backfillRequestedFrom: string | null;

  @Field(() => BenchmarkKey, { nullable: true })
  @Column({
    name: 'benchmark_key',
    type: 'enum',
    enum: BenchmarkKey,
    enumName: 'benchmark_key',
    nullable: true,
  })
  benchmarkKey: BenchmarkKey | null;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'last_price',
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  lastPrice: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_price_on', type: 'date', nullable: true })
  lastPriceOn: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

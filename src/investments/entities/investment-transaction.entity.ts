import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Instrument } from '../../market-data/entities/instrument.entity';
import { User } from '../../users/entities/user.entity';
import { InvestmentAccount } from './investment-account.entity';

export enum FxRateSource {
  MANUAL = 'manual',
  TWELVE_DATA = 'twelve_data',
  BROKER = 'broker',
  ASSUMED_ONE = 'assumed_one',
}

registerEnumType(FxRateSource, {
  name: 'FxRateSource',
  description: 'Origen de la tasa de cambio guardada en la operación',
});

// Libro de operaciones de inversión: UNA tabla y UN enum para las 13
// operaciones. Toda la analítica que pide la cartera es "reproducir el flujo
// cronológico de eventos"; una sola tabla ordenada da eso gratis, mientras que
// partirla en cinco obligaría a un UNION en cada consulta, cada conector y el
// recorrido FIFO. La forma de cada tipo se garantiza con @Check.
//
// CONVENCIÓN DE SIGNO: quantity, amount, fee y tax son SIEMPRE magnitudes no
// negativas; la dirección se deduce del `type`. Las cantidades con signo son
// el corruptor silencioso clásico de la base de costo, y el @Check las corta
// en la base de datos.
@ObjectType()
@Entity('investment_transactions')
@Check('investment_transactions_amount_check', '"amount" >= 0')
@Check('investment_transactions_fee_check', '"fee" >= 0')
@Check('investment_transactions_tax_check', '"tax" >= 0')
@Check(
  'investment_transactions_quantity_check',
  '"quantity" IS NULL OR "quantity" >= 0',
)
@Check(
  'investment_transactions_instrument_required',
  `"type" NOT IN ('buy', 'sell', 'split', 'transfer_in', 'transfer_out') OR "instrument_id" IS NOT NULL`,
)
@Check(
  'investment_transactions_split_ratio_check',
  `"type" <> 'split' OR ("split_ratio_numerator" > 0 AND "split_ratio_denominator" > 0)`,
)
@Check(
  'investment_transactions_settlement_check',
  `"type" <> 'currency_exchange' OR ("settlement_currency" IS NOT NULL AND "settlement_amount" IS NOT NULL)`,
)
@Index('idx_investment_transactions_user_date', ['userId', 'occurredOn'])
@Index('idx_investment_transactions_account', ['accountId', 'occurredOn'])
@Index(
  'idx_investment_transactions_instrument',
  ['userId', 'instrumentId', 'occurredOn'],
  { where: '"instrument_id" IS NOT NULL' },
)
@Index('uq_investment_transactions_dedupe', ['userId', 'dedupeHash'], {
  unique: true,
})
@Index('uq_investment_transactions_external', ['connectionId', 'externalId'], {
  unique: true,
  where: '"external_id" IS NOT NULL AND "connection_id" IS NOT NULL',
})
export class InvestmentTransaction {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => InvestmentAccount)
  @ManyToOne(() => InvestmentAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: InvestmentAccount;

  @Field(() => ID)
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId: string | null;

  @Field(() => InvestmentTransactionType)
  @Column({
    type: 'enum',
    enum: InvestmentTransactionType,
    enumName: 'investment_transaction_type',
  })
  type: InvestmentTransactionType;

  @Field(() => Instrument, { nullable: true })
  @ManyToOne(() => Instrument, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'instrument_id' })
  instrument: Instrument | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'instrument_id', type: 'uuid', nullable: true })
  instrumentId: string | null;

  @Field({ description: 'Fecha de la operación (YYYY-MM-DD)' })
  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  // hora exacta cuando el bróker la da: sin ella, el orden FIFO de dos
  // operaciones del mismo día es arbitrario
  @Field(() => Date, { nullable: true })
  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt: Date | null;

  @Field(() => Float, { nullable: true })
  @Column({
    type: 'numeric',
    precision: 28,
    scale: 10,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  quantity: number | null;

  @Field(() => Float, { nullable: true, description: 'Precio unitario' })
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  price: number | null;

  @Field(() => Float, { description: 'Importe bruto, siempre positivo' })
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  fee: number;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  tax: number;

  @Field()
  @Column({ type: 'char', length: 3 })
  currency: string;

  // tasa a la moneda base del usuario, congelada en el momento de escribir.
  // así un informe histórico no se mueve cuando el proveedor revisa su serie.
  @Field(() => Float)
  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: 20,
    scale: 10,
    default: 1,
    transformer: new NumericTransformer(),
  })
  fxRate: number;

  @Field(() => FxRateSource)
  @Column({
    name: 'fx_rate_source',
    type: 'enum',
    enum: FxRateSource,
    enumName: 'fx_rate_source',
    default: FxRateSource.ASSUMED_ONE,
  })
  fxRateSource: FxRateSource;

  // solo CURRENCY_EXCHANGE: lo que se recibe a cambio
  @Field(() => String, { nullable: true })
  @Column({
    name: 'settlement_currency',
    type: 'char',
    length: 3,
    nullable: true,
  })
  settlementCurrency: string | null;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'settlement_amount',
    type: 'numeric',
    precision: 20,
    scale: 6,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  settlementAmount: number | null;

  // solo SPLIT: 2:1 se guarda como numerator = 2, denominator = 1.
  // un split inverso tiene denominator > numerator.
  @Field(() => Int, { nullable: true })
  @Column({ name: 'split_ratio_numerator', type: 'int', nullable: true })
  splitRatioNumerator: number | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'split_ratio_denominator', type: 'int', nullable: true })
  splitRatioDenominator: number | null;

  // TRANSFER_OUT con destino conocido: los lotes consumidos se reabren allí
  @Field(() => ID, { nullable: true })
  @Column({ name: 'counterparty_account_id', type: 'uuid', nullable: true })
  counterpartyAccountId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId: string | null;

  // huella de deduplicación; ver src/investments/import/dedupe.ts.
  // El índice único sobre (user_id, dedupe_hash) es lo que hace que
  // reimportar el mismo CSV o resincronizar sea gratis.
  @Column({ name: 'dedupe_hash', type: 'char', length: 64 })
  dedupeHash: string;

  // válvula de escape: dos operaciones genuinamente idénticas el mismo día sin
  // id externo se distinguen por este contador.
  @Field(() => Int)
  @Column({ name: 'occurrence_index', type: 'smallint', default: 0 })
  occurrenceIndex: number;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'import_batch_id', type: 'uuid', nullable: true })
  importBatchId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

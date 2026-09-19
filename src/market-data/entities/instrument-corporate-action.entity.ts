import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Instrument } from './instrument.entity';

export enum CorporateActionType {
  DIVIDEND = 'dividend',
  SPLIT = 'split',
}

registerEnumType(CorporateActionType, {
  name: 'CorporateActionType',
  description: 'Tipo de acción corporativa',
});

// Dividendos y splits anunciados por el mercado. Dato de referencia GLOBAL,
// sin user_id: el split de Apple es el mismo para todo el mundo.
//
// Es SOLO informativo: nunca se convierte en una operación por su cuenta.
@ObjectType()
@Entity('instrument_corporate_actions')
@Index('uq_corporate_actions', ['instrumentId', 'type', 'exDate'], {
  unique: true,
})
export class InstrumentCorporateAction {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => Instrument)
  @ManyToOne(() => Instrument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instrument_id' })
  instrument: Instrument;

  @Field(() => ID)
  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId: string;

  @Field(() => CorporateActionType)
  @Column({
    type: 'enum',
    enum: CorporateActionType,
    enumName: 'corporate_action_type',
  })
  type: CorporateActionType;

  @Field({
    description: 'Fecha ex-dividendo o de efecto del split (YYYY-MM-DD)',
  })
  @Column({ name: 'ex_date', type: 'date' })
  exDate: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'pay_date', type: 'date', nullable: true })
  payDate: string | null;

  @Field(() => Float, { nullable: true, description: 'Dividendo por título' })
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  amount: number | null;

  // un 4-for-1 se guarda como numerator = 4, denominator = 1: la cantidad
  // queda multiplicada por 4
  @Field(() => Int, { nullable: true })
  @Column({ name: 'ratio_numerator', type: 'int', nullable: true })
  ratioNumerator: number | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'ratio_denominator', type: 'int', nullable: true })
  ratioDenominator: number | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

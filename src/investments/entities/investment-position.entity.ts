import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Instrument } from '../../market-data/entities/instrument.entity';
import { User } from '../../users/entities/user.entity';
import { InvestmentAccount } from './investment-account.entity';

// Posición viva por (cuenta, instrumento). Se materializa, no se deriva:
// el consumo FIFO de lotes es secuencial y no cabe en un GROUP BY.
// `rebuildInvestmentPositions` es la válvula manual, igual que
// `recalculateAccountBalance` en payment_methods.
@ObjectType()
@Entity('investment_positions')
@Index('uq_investment_positions', ['accountId', 'instrumentId'], {
  unique: true,
})
@Index('idx_investment_positions_user', ['userId'])
export class InvestmentPosition {
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

  @Field(() => Instrument)
  @ManyToOne(() => Instrument, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'instrument_id' })
  instrument: Instrument;

  @Field(() => ID)
  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 28,
    scale: 10,
    default: 0,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  // INFORME de los lotes FIFO abiertos, NO un segundo método de cálculo.
  // Jamás usarlo para computar P&L realizado.
  @Field(() => Float, {
    description: 'Costo promedio de los lotes abiertos (informativo)',
  })
  @Column({
    name: 'average_cost',
    type: 'numeric',
    precision: 24,
    scale: 10,
    default: 0,
    transformer: new NumericTransformer(),
  })
  averageCost: number;

  @Field(() => Float)
  @Column({
    name: 'cost_basis',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  costBasis: number;

  @Field(() => Float)
  @Column({
    name: 'cost_basis_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  costBasisBase: number;

  @Field()
  @Column({ type: 'char', length: 3 })
  currency: string;

  @Field(() => Float)
  @Column({
    name: 'realized_pnl_to_date_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  realizedPnlToDateBase: number;

  @Field()
  @Column({ name: 'cost_basis_is_estimated', default: false })
  costBasisIsEstimated: boolean;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_transaction_on', type: 'date', nullable: true })
  lastTransactionOn: string | null;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

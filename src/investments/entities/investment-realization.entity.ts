import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RealizationDisposition } from '../../common/enums/realization-disposition.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';
import { InvestmentAccount } from './investment-account.entity';

// Una fila por cada (venta x lote consumido). Convierte "ganancia realizada"
// en un SUM de una línea Y la deja auditable lote a lote, que es lo que
// importa la primera vez que el número parece equivocado.
@ObjectType()
@Entity('investment_realizations')
@Index('idx_investment_realizations_user_date', ['userId', 'realizedOn'])
@Index('idx_investment_realizations_instrument', [
  'userId',
  'instrumentId',
  'realizedOn',
])
export class InvestmentRealization {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => InvestmentAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: InvestmentAccount;

  @Field(() => ID)
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Field(() => ID)
  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'sell_transaction_id', type: 'uuid', nullable: true })
  sellTransactionId: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'lot_id', type: 'uuid', nullable: true })
  lotId: string | null;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 28,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Field(() => Float)
  @Column({
    name: 'proceeds_per_unit',
    type: 'numeric',
    precision: 24,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  proceedsPerUnit: number;

  @Field(() => Float)
  @Column({
    name: 'cost_per_unit',
    type: 'numeric',
    precision: 24,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  costPerUnit: number;

  @Field(() => Float)
  @Column({
    name: 'realized_pnl',
    type: 'numeric',
    precision: 20,
    scale: 6,
    transformer: new NumericTransformer(),
  })
  realizedPnl: number;

  @Field(() => Float)
  @Column({
    name: 'realized_pnl_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    transformer: new NumericTransformer(),
  })
  realizedPnlBase: number;

  @Field()
  @Column({ type: 'char', length: 3 })
  currency: string;

  @Field({ description: 'Fecha de la realización (YYYY-MM-DD)' })
  @Column({ name: 'realized_on', type: 'date' })
  realizedOn: string;

  @Field(() => RealizationDisposition)
  @Column({
    type: 'enum',
    enum: RealizationDisposition,
    enumName: 'realization_disposition',
    default: RealizationDisposition.SALE,
  })
  disposition: RealizationDisposition;

  @Field()
  @Column({ name: 'cost_basis_is_estimated', default: false })
  costBasisIsEstimated: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

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
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Instrument } from '../../market-data/entities/instrument.entity';
import { User } from '../../users/entities/user.entity';
import { InvestmentAccount } from './investment-account.entity';

// Lote fiscal FIFO: una compra (o entrada por transferencia) con su base de
// costo propia. El consumo FIFO es inherentemente secuencial, no se puede
// expresar como un GROUP BY, así que este es el único sitio donde el
// resultado puede vivir.
@ObjectType()
@Entity('investment_lots')
@Index('idx_investment_lots_open', [
  'userId',
  'instrumentId',
  'accountId',
  'openedOn',
])
@Index('idx_investment_lots_remaining', ['accountId', 'instrumentId'], {
  where: '"quantity_open" > 0',
})
export class InvestmentLot {
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

  @Field(() => ID, { nullable: true })
  @Column({ name: 'open_transaction_id', type: 'uuid', nullable: true })
  openTransactionId: string | null;

  @Field({ description: 'Fecha de apertura del lote (YYYY-MM-DD)' })
  @Column({ name: 'opened_on', type: 'date' })
  openedOn: string;

  @Field(() => Float)
  @Column({
    name: 'quantity_original',
    type: 'numeric',
    precision: 28,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  quantityOriginal: number;

  @Field(() => Float, { description: 'Cantidad que queda sin vender' })
  @Column({
    name: 'quantity_open',
    type: 'numeric',
    precision: 28,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  quantityOpen: number;

  @Field(() => Float, { description: 'Costo unitario en la moneda del lote' })
  @Column({
    name: 'cost_per_unit',
    type: 'numeric',
    precision: 24,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  costPerUnit: number;

  @Field()
  @Column({ type: 'char', length: 3 })
  currency: string;

  @Field(() => Float, {
    description: 'Costo unitario en la moneda base del usuario',
  })
  @Column({
    name: 'cost_per_unit_base',
    type: 'numeric',
    precision: 24,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  costPerUnitBase: number;

  // true cuando la base salió de un precio de mercado o quedó en 0 porque el
  // bróker no la dio. Se propaga hasta el DTO: un P&L realizado calculado
  // sobre una base estimada se MARCA, no se publica como si fuera exacto.
  @Field()
  @Column({ name: 'cost_basis_is_estimated', default: false })
  costBasisIsEstimated: boolean;

  @Field(() => String, { nullable: true })
  @Column({ name: 'closed_on', type: 'date', nullable: true })
  closedOn: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

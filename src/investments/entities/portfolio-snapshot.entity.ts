import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
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
import { User } from '../../users/entities/user.entity';

// Foto diaria de la cartera en moneda base.
//
// Hace falta de verdad: "evolución del patrimonio" y el TWR son lecturas O(días)
// que si no habría que recalcular en O(operaciones x días) cada vez. Y sobre
// todo, el factor diario del TWR DEBE persistirse: encadenar no se puede
// rederivar solo desde el estado final.
@ObjectType()
@Entity('portfolio_snapshots')
// account_id NULL = cartera completa. Hacen falta dos índices parciales porque
// Postgres no deduplica NULLs en un UNIQUE normal.
@Index('uq_portfolio_snapshots_total', ['userId', 'snapshotOn'], {
  unique: true,
  where: '"account_id" IS NULL',
})
@Index(
  'uq_portfolio_snapshots_account',
  ['userId', 'accountId', 'snapshotOn'],
  {
    unique: true,
    where: '"account_id" IS NOT NULL',
  },
)
export class PortfolioSnapshot {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => ID, { nullable: true, description: 'null = cartera completa' })
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Field({ description: 'Fecha de la foto (YYYY-MM-DD)' })
  @Column({ name: 'snapshot_on', type: 'date' })
  snapshotOn: string;

  @Field(() => Float, { description: 'Valor de las posiciones a mercado' })
  @Column({
    name: 'market_value_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  marketValueBase: number;

  @Field(() => Float)
  @Column({
    name: 'cash_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  cashBase: number;

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

  @Field(() => Float, {
    description: 'Capital aportado acumulado hasta la fecha',
  })
  @Column({
    name: 'contributions_to_date_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  contributionsToDateBase: number;

  @Field(() => Float, { description: 'Flujo externo NETO del día' })
  @Column({
    name: 'net_flow_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  netFlowBase: number;

  @Field(() => Float)
  @Column({
    name: 'unrealized_pnl_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  unrealizedPnlBase: number;

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

  @Field(() => Float)
  @Column({
    name: 'dividends_to_date_base',
    type: 'numeric',
    precision: 20,
    scale: 6,
    default: 0,
    transformer: new NumericTransformer(),
  })
  dividendsToDateBase: number;

  // factor del día: V_d / (V_{d-1} + F_d). Escala 12 porque encadenar multiplica
  // miles de factores y el truncamiento se acumula.
  @Field(() => Float, { description: 'Factor TWR del día' })
  @Column({
    name: 'twr_factor',
    type: 'numeric',
    precision: 20,
    scale: 12,
    default: 1,
    transformer: new NumericTransformer(),
  })
  twrFactor: number;

  @Field(() => Float, { description: 'Índice TWR encadenado, base 100' })
  @Column({
    name: 'twr_index',
    type: 'numeric',
    precision: 20,
    scale: 12,
    default: 100,
    transformer: new NumericTransformer(),
  })
  twrIndex: number;

  @Field({
    description: 'true si algún precio se arrastró de un día anterior',
  })
  @Column({ name: 'is_estimated', default: false })
  isEstimated: boolean;

  @Field(() => Int, { description: 'Posiciones sin precio ese día' })
  @Column({ name: 'missing_price_count', type: 'int', default: 0 })
  missingPriceCount: number;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

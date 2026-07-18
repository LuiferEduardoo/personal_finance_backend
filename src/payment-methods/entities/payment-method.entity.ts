import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';

export enum PaymentMethodType {
  CASH = 'cash',
  DEBIT = 'debit',
  CREDIT = 'credit',
  BANK_TRANSFER = 'bank_transfer',
  DIGITAL_WALLET = 'digital_wallet',
  OTHER = 'other',
}

@Entity('payment_methods')
@Unique('payment_methods_name_unique', ['userId', 'name'])
@Check(
  'payment_methods_credit_only',
  `"type" = 'credit' OR ("credit_limit" IS NULL AND "statement_day" IS NULL AND "due_day" IS NULL)`,
)
@Check(
  'payment_methods_credit_limit_check',
  '"credit_limit" IS NULL OR "credit_limit" >= 0',
)
@Check(
  'payment_methods_statement_day_check',
  '"statement_day" IS NULL OR "statement_day" BETWEEN 1 AND 31',
)
@Check(
  'payment_methods_due_day_check',
  '"due_day" IS NULL OR "due_day" BETWEEN 1 AND 31',
)
@Index('idx_payment_methods_user', ['userId'], { where: '"is_active"' })
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.paymentMethods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // "Bancolombia Debit", "Visa Falabella"
  @Column({ type: 'text' })
  name: string;

  @Column({
    type: 'enum',
    enum: PaymentMethodType,
    enumName: 'payment_method_type',
  })
  type: PaymentMethodType;

  @Column({ type: 'text', nullable: true })
  issuer: string | null;

  @Column({ name: 'last_four', type: 'char', length: 4, nullable: true })
  lastFour: string | null;

  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  // solo para tarjetas de crédito
  @Column({
    name: 'credit_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  creditLimit: number | null;

  @Column({ name: 'statement_day', type: 'smallint', nullable: true })
  statementDay: number | null;

  @Column({ name: 'due_day', type: 'smallint', nullable: true })
  dueDay: number | null;

  @Column({
    name: 'monthly_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  monthlyRate: number | null;

  @Column({
    name: 'opening_balance',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  openingBalance: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

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

registerEnumType(PaymentMethodType, { name: 'PaymentMethodType' });

// cuenta de la que salen gastos y a la que entran ingresos
// (efectivo, cuenta bancaria, tarjeta, billetera, etc.)
@ObjectType('Account')
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
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.paymentMethods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // "Bancolombia Debit", "Visa Falabella", "Efectivo"
  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => PaymentMethodType)
  @Column({
    type: 'enum',
    enum: PaymentMethodType,
    enumName: 'payment_method_type',
  })
  type: PaymentMethodType;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  issuer: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_four', type: 'char', length: 4, nullable: true })
  lastFour: string | null;

  @Field()
  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  // solo para tarjetas de crédito
  @Field(() => Float, { nullable: true })
  @Column({
    name: 'credit_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  creditLimit: number | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'statement_day', type: 'smallint', nullable: true })
  statementDay: number | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'due_day', type: 'smallint', nullable: true })
  dueDay: number | null;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'monthly_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  monthlyRate: number | null;

  @Field(() => Float, { description: 'Saldo inicial de la cuenta' })
  @Column({
    name: 'opening_balance',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  openingBalance: number;

  // saldo actual (saldo inicial + ingresos − gastos + transferencias).
  // en cuentas de crédito, negativo = deuda.
  @Field(() => Float, {
    description: 'Saldo actual (negativo = deuda en crédito)',
  })
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  balance: number;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // cupo disponible en tarjetas de crédito = creditLimit + balance (balance negativo)
  @Field(() => Float, {
    nullable: true,
    description: 'Cupo disponible (solo tarjetas de crédito)',
  })
  get availableCredit(): number | null {
    if (this.type !== PaymentMethodType.CREDIT || this.creditLimit == null) {
      return null;
    }
    return this.creditLimit + this.balance;
  }
}

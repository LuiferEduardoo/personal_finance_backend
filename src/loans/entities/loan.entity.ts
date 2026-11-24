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
import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { Category } from '../../categories/entities/category.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { User } from '../../users/entities/user.entity';

export enum LoanRateType {
  MONTHLY = 'monthly',
  EFFECTIVE_ANNUAL = 'effective_annual',
}

export enum LoanStatus {
  ACTIVE = 'active',
  PAID_OFF = 'paid_off',
}

registerEnumType(LoanRateType, {
  name: 'LoanRateType',
  description: 'Cómo se expresa la tasa del crédito',
  valuesMap: {
    MONTHLY: { description: 'Tasa mensual vencida' },
    EFFECTIVE_ANNUAL: { description: 'Tasa efectiva anual (EA)' },
  },
});
registerEnumType(LoanStatus, { name: 'LoanStatus' });

// Crédito personal (libre inversión, vehículo, hipotecario...). Las
// condiciones financieras (capital, tasa, plazo, fechas, cargos) son
// inmutables una vez creado: la tabla de cuotas solo cambia con abonos a
// capital. El desembolso NO es un ingreso: solo suma al saldo de la cuenta.
@ObjectType({ description: 'Crédito personal con su tabla de amortización' })
@Entity('loans')
@Check('loans_principal_amount_check', '"principal_amount" > 0')
@Check('loans_installment_count_check', '"installment_count" BETWEEN 1 AND 600')
@Index('idx_loans_user', ['userId'])
export class Loan {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_loans' })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_loans_user' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => String, { nullable: true, description: 'Entidad que presta' })
  @Column({ type: 'text', nullable: true })
  lender: string | null;

  @Field(() => Float)
  @Column({
    name: 'principal_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  principalAmount: number;

  @Field()
  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  @Field(() => LoanRateType)
  @Column({
    name: 'rate_type',
    type: 'enum',
    enum: LoanRateType,
    enumName: 'loan_rate_type',
  })
  rateType: LoanRateType;

  @Field(() => Float, {
    description: 'Tasa tal como se ingresó, en decimal (0.24 = 24%)',
  })
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  rate: number;

  @Field(() => Float, {
    description: 'Tasa mensual con la que se calcula la tabla',
  })
  @Column({
    name: 'monthly_rate',
    type: 'numeric',
    precision: 12,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  monthlyRate: number;

  @Field(() => Int, { description: 'Plazo pactado al crear el crédito' })
  @Column({ name: 'installment_count', type: 'smallint' })
  installmentCount: number;

  @Field()
  @Column({ name: 'disbursed_on', type: 'date' })
  disbursedOn: string;

  @Field()
  @Column({ name: 'first_due_date', type: 'date' })
  firstDueDate: string;

  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'disbursement_account_id',
    foreignKeyConstraintName: 'FK_loans_disbursement_account',
  })
  disbursementAccount: PaymentMethod | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta a la que entró el desembolso',
  })
  @Column({ name: 'disbursement_account_id', type: 'uuid', nullable: true })
  disbursementAccountId: string | null;

  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'payment_account_id',
    foreignKeyConstraintName: 'FK_loans_payment_account',
  })
  paymentAccount: PaymentMethod | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta por defecto de la que salen los pagos',
  })
  @Column({ name: 'payment_account_id', type: 'uuid', nullable: true })
  paymentAccountId: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_loans_category',
  })
  category: Category | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Categoría de los gastos de pago',
  })
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Field(() => LoanStatus)
  @Column({
    type: 'enum',
    enum: LoanStatus,
    enumName: 'loan_status',
    default: LoanStatus.ACTIVE,
  })
  status: LoanStatus;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Expense } from '../../transactions/entities/expense.entity';
import { Loan } from './loan.entity';

export enum LoanInstallmentStatus {
  PENDING = 'pending',
  PAID = 'paid',
}

registerEnumType(LoanInstallmentStatus, { name: 'LoanInstallmentStatus' });

const money = () => ({
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  transformer: new NumericTransformer(),
});

// cuota de un crédito: capital + interés + cargos. Al pagarla se registra un
// gasto (expenseId); si ese gasto se borra a mano, la cuota sigue pagada
@ObjectType({ description: 'Cuota de un crédito' })
@Entity('loan_installments')
@Unique('loan_installments_sequence_unique', ['loanId', 'sequenceNumber'])
@Check('loan_installments_sequence_number_check', '"sequence_number" > 0')
@Check('loan_installments_amount_check', '"amount" >= 0')
@Check(
  'loan_installments_paid_check',
  `("status" = 'paid') = ("paid_on" IS NOT NULL)`,
)
export class LoanInstallment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_loan_installments',
  })
  id: string;

  @ManyToOne(() => Loan, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'loan_id',
    foreignKeyConstraintName: 'FK_loan_installments_loan',
  })
  loan: Loan;

  @Field(() => ID)
  @Column({ name: 'loan_id', type: 'uuid' })
  loanId: string;

  @Field(() => Int)
  @Column({ name: 'sequence_number', type: 'smallint' })
  sequenceNumber: number;

  @Field()
  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Field(() => Float, {
    description: 'Saldo de capital al inicio del periodo',
  })
  @Column({ name: 'opening_balance', ...money() })
  openingBalance: number;

  @Field(() => Float)
  @Column({ name: 'principal_amount', ...money() })
  principalAmount: number;

  @Field(() => Float)
  @Column({ name: 'interest_amount', ...money() })
  interestAmount: number;

  @Field(() => Float, { description: 'Seguros y comisiones del periodo' })
  @Column({ name: 'charges_amount', ...money() })
  chargesAmount: number;

  @Field(() => Float, { description: 'Total: capital + interés + cargos' })
  @Column(money())
  amount: number;

  @Field(() => LoanInstallmentStatus)
  @Column({
    type: 'enum',
    enum: LoanInstallmentStatus,
    enumName: 'loan_installment_status',
    default: LoanInstallmentStatus.PENDING,
  })
  status: LoanInstallmentStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn: string | null;

  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'expense_id',
    foreignKeyConstraintName: 'FK_loan_installments_expense',
  })
  expense: Expense | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Gasto con el que se pagó',
  })
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;
}

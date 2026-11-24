import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  Field,
  Float,
  ID,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Expense } from '../../transactions/entities/expense.entity';
import { Loan } from './loan.entity';

export enum LoanPrepaymentMode {
  REDUCE_TERM = 'reduce_term',
  REDUCE_PAYMENT = 'reduce_payment',
}

registerEnumType(LoanPrepaymentMode, {
  name: 'LoanPrepaymentMode',
  valuesMap: {
    REDUCE_TERM: {
      description: 'Conserva la cuota y reduce el número de cuotas',
    },
    REDUCE_PAYMENT: {
      description: 'Conserva el número de cuotas y reduce la cuota',
    },
  },
});

// abono extraordinario a capital; regenera las cuotas pendientes
@ObjectType({ description: 'Abono extraordinario a capital de un crédito' })
@Entity('loan_prepayments')
@Check('loan_prepayments_amount_check', '"amount" > 0')
@Index('idx_loan_prepayments_loan', ['loanId'])
export class LoanPrepayment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_loan_prepayments',
  })
  id: string;

  @ManyToOne(() => Loan, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'loan_id',
    foreignKeyConstraintName: 'FK_loan_prepayments_loan',
  })
  loan: Loan;

  @Field(() => ID)
  @Column({ name: 'loan_id', type: 'uuid' })
  loanId: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Field()
  @Column({ name: 'paid_on', type: 'date' })
  paidOn: string;

  @Field(() => LoanPrepaymentMode)
  @Column({
    type: 'enum',
    enum: LoanPrepaymentMode,
    enumName: 'loan_prepayment_mode',
  })
  mode: LoanPrepaymentMode;

  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'expense_id',
    foreignKeyConstraintName: 'FK_loan_prepayments_expense',
  })
  expense: Expense | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

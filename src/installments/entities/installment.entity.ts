import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { InstallmentPlan } from './installment-plan.entity';

export enum InstallmentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

@Entity('installments')
@Unique('installments_sequence_unique', ['planId', 'sequenceNumber'])
@Check('installments_sequence_number_check', '"sequence_number" > 0')
@Check('installments_amount_check', '"amount" >= 0')
@Check('installments_paid_check', `("status" = 'paid') = ("paid_at" IS NOT NULL)`)
@Index('idx_installments_pending', ['dueDate'], {
  where: `"status" = 'pending'`,
})
export class Installment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InstallmentPlan, (plan) => plan.installments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: InstallmentPlan;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'sequence_number', type: 'smallint' })
  sequenceNumber: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Column({
    name: 'principal_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  principalAmount: number;

  @Column({
    name: 'interest_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  interestAmount: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt: string | null;

  @Column({
    type: 'enum',
    enum: InstallmentStatus,
    enumName: 'installment_status',
    default: InstallmentStatus.PENDING,
  })
  status: InstallmentStatus;
}

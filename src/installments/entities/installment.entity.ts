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
import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { InstallmentPlan } from './installment-plan.entity';

export enum InstallmentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

registerEnumType(InstallmentStatus, { name: 'InstallmentStatus' });

@ObjectType()
@Entity('installments')
@Unique('installments_sequence_unique', ['planId', 'sequenceNumber'])
@Check('installments_sequence_number_check', '"sequence_number" > 0')
@Check('installments_amount_check', '"amount" >= 0')
@Check(
  'installments_paid_check',
  `("status" = 'paid') = ("paid_at" IS NOT NULL)`,
)
@Index('idx_installments_pending', ['dueDate'], {
  where: `"status" = 'pending'`,
})
export class Installment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InstallmentPlan, (plan) => plan.installments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: InstallmentPlan;

  @Field(() => ID)
  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Field(() => Int)
  @Column({ name: 'sequence_number', type: 'smallint' })
  sequenceNumber: number;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Field(() => Float)
  @Column({
    name: 'principal_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  principalAmount: number;

  @Field(() => Float)
  @Column({
    name: 'interest_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: new NumericTransformer(),
  })
  interestAmount: number;

  @Field()
  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Field({ nullable: true })
  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt: string | null;

  @Field(() => InstallmentStatus)
  @Column({
    type: 'enum',
    enum: InstallmentStatus,
    enumName: 'installment_status',
    default: InstallmentStatus.PENDING,
  })
  status: InstallmentStatus;
}

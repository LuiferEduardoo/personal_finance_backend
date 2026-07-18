import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { User } from '../../users/entities/user.entity';
import { Installment } from './installment.entity';

@Entity('installment_plans')
@Check('installment_plans_total_amount_check', '"total_amount" > 0')
@Check(
  'installment_plans_installment_count_check',
  '"installment_count" BETWEEN 1 AND 120',
)
@Index('idx_installment_plans_user', ['userId'], { where: 'NOT "is_closed"' })
export class InstallmentPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.installmentPlans, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => PaymentMethod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_method_id' })
  paymentMethod: PaymentMethod;

  @Column({ name: 'payment_method_id', type: 'uuid' })
  paymentMethodId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  totalAmount: number;

  @Column({ name: 'installment_count', type: 'smallint' })
  installmentCount: number;

  @Column({
    name: 'monthly_rate',
    type: 'numeric',
    precision: 6,
    scale: 4,
    default: 0,
    transformer: new NumericTransformer(),
  })
  monthlyRate: number;

  @Column({ name: 'purchase_date', type: 'date' })
  purchaseDate: string;

  @Column({ name: 'first_due_date', type: 'date' })
  firstDueDate: string;

  @Column({ name: 'is_closed', default: false })
  isClosed: boolean;

  @OneToMany(() => Installment, (installment) => installment.plan)
  installments: Installment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

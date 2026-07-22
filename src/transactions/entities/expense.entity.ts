import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Installment } from '../../installments/entities/installment.entity';
import { InstallmentPlan } from '../../installments/entities/installment-plan.entity';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { Tag } from '../../tags/entities/tag.entity';
import { User } from '../../users/entities/user.entity';
import { ExpenseItem } from './expense-item.entity';

@ObjectType()
@Entity('expenses')
@Check('expenses_amount_check', '"amount" > 0')
@Index('idx_expenses_user_date', ['userId', 'occurredOn'])
export class Expense {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => Category, { nullable: true })
  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Field(() => ID, { nullable: true })
  @Index('idx_expenses_category')
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  // cuenta de la que sale el gasto (expuesta como "account" en GraphQL)
  @Field(() => PaymentMethod, { name: 'account', nullable: true })
  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_method_id' })
  paymentMethod: PaymentMethod | null;

  @Field(() => ID, { name: 'accountId', nullable: true })
  @Index('idx_expenses_payment_method')
  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId: string | null;

  @ManyToOne(() => InstallmentPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan: InstallmentPlan | null;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId: string | null;

  @ManyToOne(() => Installment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'installment_id' })
  installment: Installment | null;

  @Column({ name: 'installment_id', type: 'uuid', nullable: true })
  installmentId: string | null;

  // líneas del gasto: cada una un artículo con su precio y cantidad.
  // el importe (amount) = suma de los subtotales de los ítems.
  @Field(() => [ExpenseItem])
  @OneToMany(() => ExpenseItem, (item) => item.expense, { cascade: true })
  items: ExpenseItem[];

  @Field()
  @Column({ type: 'text' })
  description: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Field()
  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  @Field(() => Float)
  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 14,
    scale: 6,
    default: 1,
    transformer: new NumericTransformer(),
  })
  exchangeRate: number;

  @Field()
  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  merchant: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'receipt_url', type: 'text', nullable: true })
  receiptUrl: string | null;

  @Field(() => Recurrence)
  @Column({
    type: 'enum',
    enum: Recurrence,
    enumName: 'recurrence',
    default: Recurrence.ONCE,
  })
  recurrence: Recurrence;

  @ManyToMany(() => Tag, (tag) => tag.expenses)
  @JoinTable({
    name: 'expense_tags',
    joinColumn: { name: 'expense_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: Tag[];

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

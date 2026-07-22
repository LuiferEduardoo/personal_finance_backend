import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { User } from '../../users/entities/user.entity';
import { RecurringExpenseItem } from './recurring-expense-item.entity';

// plantilla de un gasto que se genera periódicamente (mensual, semanal, etc.)
@ObjectType()
@Entity('recurring_expenses')
@Index('idx_recurring_expenses_due', ['nextRunOn'], { where: '"is_active"' })
export class RecurringExpense {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field()
  @Column({ type: 'text' })
  description: string;

  @Field(() => Category, { nullable: true })
  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Field(() => PaymentMethod, { name: 'account', nullable: true })
  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_method_id' })
  paymentMethod: PaymentMethod | null;

  @Field(() => ID, { name: 'accountId', nullable: true })
  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId: string | null;

  // importe fijo cuando la plantilla no lleva ítems
  @Field(() => Float, { nullable: true })
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  amount: number | null;

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

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  merchant: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Field(() => Recurrence, { description: 'Frecuencia (no puede ser ONCE)' })
  @Column({ type: 'enum', enum: Recurrence, enumName: 'recurrence' })
  recurrence: Recurrence;

  @Field({ description: 'Fecha de la primera ocurrencia (YYYY-MM-DD)' })
  @Column({ name: 'start_on', type: 'date' })
  startOn: string;

  @Field({ description: 'Próxima fecha en la que se generará un gasto' })
  @Column({ name: 'next_run_on', type: 'date' })
  nextRunOn: string;

  @Field(() => String, {
    nullable: true,
    description: 'Fecha límite; al superarla la plantilla se desactiva',
  })
  @Column({ name: 'end_on', type: 'date', nullable: true })
  endOn: string | null;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field(() => [RecurringExpenseItem])
  @OneToMany(() => RecurringExpenseItem, (item) => item.recurringExpense, {
    cascade: true,
  })
  items: RecurringExpenseItem[];

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

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
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Recurrence } from '../../common/enums/recurrence.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { Tag } from '../../tags/entities/tag.entity';
import { User } from '../../users/entities/user.entity';

@Entity('incomes')
@Check('incomes_amount_check', '"amount" > 0')
@Index('idx_incomes_user_date', ['userId', 'occurredOn'])
export class Income {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.incomes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  // cuenta destino
  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_method_id' })
  paymentMethod: PaymentMethod | null;

  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  source: string | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 14,
    scale: 6,
    default: 1,
    transformer: new NumericTransformer(),
  })
  exchangeRate: number;

  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({
    type: 'enum',
    enum: Recurrence,
    enumName: 'recurrence',
    default: Recurrence.ONCE,
  })
  recurrence: Recurrence;

  @ManyToMany(() => Tag, (tag) => tag.incomes)
  @JoinTable({
    name: 'income_tags',
    joinColumn: { name: 'income_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: Tag[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

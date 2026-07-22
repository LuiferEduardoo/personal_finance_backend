import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Article } from '../../articles/entities/article.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { RecurringExpense } from './recurring-expense.entity';

// espejo de ExpenseItem para la plantilla recurrente
@ObjectType()
@Entity('recurring_expense_items')
@Check('recurring_expense_items_unit_price_check', '"unit_price" >= 0')
@Check('recurring_expense_items_quantity_check', '"quantity" > 0')
export class RecurringExpenseItem {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RecurringExpense, (re) => re.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recurring_expense_id' })
  recurringExpense: RecurringExpense;

  @Field(() => ID)
  @Column({ name: 'recurring_expense_id', type: 'uuid' })
  recurringExpenseId: string;

  @Field(() => Article, { nullable: true })
  @ManyToOne(() => Article, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'article_id' })
  article: Article | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'article_id', type: 'uuid', nullable: true })
  articleId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Field(() => Float)
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  unitPrice: number;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;
}

import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
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
import { Article } from '../../articles/entities/article.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Expense } from './expense.entity';

// línea de un gasto: un artículo con su precio y cantidad.
// el importe del gasto = suma de los subtotales de sus ítems.
@ObjectType()
@Entity('expense_items')
@Check('expense_items_unit_price_check', '"unit_price" >= 0')
@Check('expense_items_quantity_check', '"quantity" > 0')
export class ExpenseItem {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Expense, (expense) => expense.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'expense_id' })
  expense: Expense;

  @Field(() => ID)
  @Index('idx_expense_items_expense')
  @Column({ name: 'expense_id', type: 'uuid' })
  expenseId: string;

  // SET NULL: preserva la línea (y su precio) si se borra el artículo
  @Field(() => Article, { nullable: true })
  @ManyToOne(() => Article, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'article_id' })
  article: Article | null;

  @Field(() => ID, { nullable: true })
  @Index('idx_expense_items_article')
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

  @Field(() => Float, { description: 'unit_price * quantity' })
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    generatedType: 'STORED',
    asExpression: '"unit_price" * "quantity"',
    transformer: new NumericTransformer(),
  })
  subtotal: number;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

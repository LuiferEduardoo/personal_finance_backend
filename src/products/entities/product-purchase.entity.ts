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
import { Expense } from '../../transactions/entities/expense.entity';
import { User } from '../../users/entities/user.entity';

// línea de compra: un gasto (ej. mercado) puede tener muchas compras de artículos
@ObjectType()
@Entity('product_purchases')
@Check('product_purchases_quantity_check', '"quantity" > 0')
@Check(
  'product_purchases_unit_price_check',
  '"unit_price" IS NULL OR "unit_price" >= 0',
)
@Index('idx_product_purchases_article', ['articleId', 'purchasedOn'])
export class ProductPurchase {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.productPurchases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => Article)
  @ManyToOne(() => Article, (article) => article.purchases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'article_id' })
  article: Article;

  @Field(() => ID)
  @Column({ name: 'article_id', type: 'uuid' })
  articleId: string;

  // null si no está ligada a un gasto registrado
  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'expense_id' })
  expense: Expense | null;

  @Field(() => ID, { nullable: true })
  @Index('idx_product_purchases_expense')
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  unitPrice: number | null;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'total_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    generatedType: 'STORED',
    asExpression: '"unit_price" * "quantity"',
    nullable: true,
    transformer: new NumericTransformer(),
  })
  totalPrice: number | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  store: string | null;

  @Field()
  @Column({ name: 'purchased_on', type: 'date' })
  purchasedOn: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

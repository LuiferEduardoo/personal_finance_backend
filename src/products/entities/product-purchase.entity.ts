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
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Expense } from '../../transactions/entities/expense.entity';
import { User } from '../../users/entities/user.entity';
import { Product } from './product.entity';

// línea de compra: un gasto (ej. mercado) puede tener muchas compras de productos
@Entity('product_purchases')
@Check('product_purchases_quantity_check', '"quantity" > 0')
@Check(
  'product_purchases_unit_price_check',
  '"unit_price" IS NULL OR "unit_price" >= 0',
)
@Index('idx_product_purchases_product', ['productId', 'purchasedOn'])
export class ProductPurchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.productPurchases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // null si no está ligada a un gasto registrado
  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'expense_id' })
  expense: Expense | null;

  @Index('idx_product_purchases_expense')
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  unitPrice: number | null;

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

  @Column({ type: 'text', nullable: true })
  store: string | null;

  @Column({ name: 'purchased_on', type: 'date' })
  purchasedOn: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

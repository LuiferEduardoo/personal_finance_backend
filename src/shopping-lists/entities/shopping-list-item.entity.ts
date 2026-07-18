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
import { ProductPurchase } from '../../products/entities/product-purchase.entity';
import { Product } from '../../products/entities/product.entity';
import { ShoppingList } from './shopping-list.entity';

export enum ListItemStatus {
  PENDING = 'pending',
  PURCHASED = 'purchased',
  SKIPPED = 'skipped',
}

@Entity('shopping_list_items')
@Check('list_item_has_ref', '"product_id" IS NOT NULL OR "free_text" IS NOT NULL')
@Check('shopping_list_items_quantity_check', '"quantity" > 0')
@Index('idx_list_items_pending', ['listId', 'position'], {
  where: `"status" = 'pending'`,
})
export class ShoppingListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ShoppingList, (list) => list.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list: ShoppingList;

  @Column({ name: 'list_id', type: 'uuid' })
  listId: string;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  // para ítems que aún no están en el catálogo
  @Column({ name: 'free_text', type: 'text', nullable: true })
  freeText: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Column({
    type: 'enum',
    enum: ListItemStatus,
    enumName: 'list_item_status',
    default: ListItemStatus.PENDING,
  })
  status: ListItemStatus;

  // true si lo agregó el predictor de agotamiento
  @Column({ name: 'auto_added', default: false })
  autoAdded: boolean;

  @ManyToOne(() => ProductPurchase, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_purchase_id' })
  productPurchase: ProductPurchase | null;

  @Column({ name: 'product_purchase_id', type: 'uuid', nullable: true })
  productPurchaseId: string | null;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

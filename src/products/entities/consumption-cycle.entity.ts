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
import { User } from '../../users/entities/user.entity';
import { ProductPurchase } from './product-purchase.entity';
import { Product } from './product.entity';

// ciclo de consumo: desde "lo empecé a usar" hasta "se acabó"
@Entity('consumption_cycles')
@Check('cycles_date_order', '"depleted_on" IS NULL OR "depleted_on" >= "started_on"')
@Check('consumption_cycles_quantity_check', '"quantity" > 0')
@Index('idx_cycles_product', ['productId', 'startedOn'])
@Index('idx_cycles_one_open', ['productId'], {
  unique: true,
  where: '"depleted_on" IS NULL',
})
export class ConsumptionCycle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.consumptionCycles, {
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

  @ManyToOne(() => ProductPurchase, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'purchase_id' })
  purchase: ProductPurchase | null;

  @Column({ name: 'purchase_id', type: 'uuid', nullable: true })
  purchaseId: string | null;

  @Column({ name: 'started_on', type: 'date' })
  startedOn: string;

  // null = todavía en uso
  @Column({ name: 'depleted_on', type: 'date', nullable: true })
  depletedOn: string | null;

  @Column({
    name: 'days_lasted',
    type: 'integer',
    generatedType: 'STORED',
    asExpression: '"depleted_on" - "started_on"',
    nullable: true,
  })
  daysLasted: number | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';

export enum UnitOfMeasure {
  UNIT = 'unit',
  GRAM = 'g',
  KILOGRAM = 'kg',
  MILLILITER = 'ml',
  LITER = 'l',
  PACK = 'pack',
  ROLL = 'roll',
  PAIR = 'pair',
  OTHER = 'other',
}

// catálogo: una fila por cosa que el usuario compra repetidamente
@Entity('products')
@Unique('products_name_unique', [
  'userId',
  'name',
  'brand',
  'packageSize',
  'unit',
])
@Index('idx_products_user', ['userId'], { where: '"is_active"' })
@Index('idx_products_barcode', ['userId', 'barcode'], {
  where: '"barcode" IS NOT NULL',
})
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  // "Shampoo Head & Shoulders"
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  brand: string | null;

  @Column({
    name: 'package_size',
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  packageSize: number | null;

  @Column({
    type: 'enum',
    enum: UnitOfMeasure,
    enumName: 'unit_of_measure',
    default: UnitOfMeasure.UNIT,
  })
  unit: UnitOfMeasure;

  @Column({ type: 'text', nullable: true })
  barcode: string | null;

  // false = bien durable, sin ciclo de agotamiento
  @Column({ name: 'is_consumable', default: true })
  isConsumable: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

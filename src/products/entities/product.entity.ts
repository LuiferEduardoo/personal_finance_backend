import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
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
import { Article } from '../../articles/entities/article.entity';
import { Category } from '../../categories/entities/category.entity';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';

// catálogo: una fila por cosa que el usuario compra repetidamente
@ObjectType()
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
@Index('idx_products_article', ['articleId'], {
  unique: true,
  where: '"article_id" IS NOT NULL',
})
export class Product {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.products, { onDelete: 'CASCADE' })
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
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  // artículo (catálogo general) del que este producto es la ficha de inventario
  @Field(() => Article, { nullable: true })
  @ManyToOne(() => Article, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'article_id' })
  article: Article | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'article_id', type: 'uuid', nullable: true })
  articleId: string | null;

  // "Shampoo Head & Shoulders"
  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  brand: string | null;

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'package_size',
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  packageSize: number | null;

  @Field(() => UnitOfMeasure)
  @Column({
    type: 'enum',
    enum: UnitOfMeasure,
    enumName: 'unit_of_measure',
    default: UnitOfMeasure.UNIT,
  })
  unit: UnitOfMeasure;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  barcode: string | null;

  // false = bien durable, sin ciclo de agotamiento
  @Field()
  @Column({ name: 'is_consumable', default: true })
  isConsumable: boolean;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

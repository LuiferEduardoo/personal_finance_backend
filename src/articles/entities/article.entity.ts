import {
  Field,
  Float,
  ID,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';
import { ConsumptionCycle } from '../../products/entities/consumption-cycle.entity';
import { ProductPurchase } from '../../products/entities/product-purchase.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';

export enum ArticleType {
  PRODUCT = 'product',
  SERVICE = 'service',
  OTHER = 'other',
}

registerEnumType(ArticleType, { name: 'ArticleType' });

// catálogo general de lo que el usuario compra: productos, servicios, etc.
// los de tipo producto llevan además datos de inventario (stock, ciclos).
@ObjectType()
@Entity('articles')
@Unique('articles_name_unique', ['userId', 'name', 'type'])
@Index('idx_articles_user', ['userId'], { where: '"is_active"' })
@Index('idx_articles_barcode', ['userId', 'barcode'], {
  where: '"barcode" IS NOT NULL',
})
export class Article {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.articles, { onDelete: 'CASCADE' })
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

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => ArticleType)
  @Column({
    type: 'enum',
    enum: ArticleType,
    enumName: 'article_type',
    default: ArticleType.PRODUCT,
  })
  type: ArticleType;

  @Field(() => UnitOfMeasure, { nullable: true })
  @Column({
    type: 'enum',
    enum: UnitOfMeasure,
    enumName: 'unit_of_measure',
    nullable: true,
    default: UnitOfMeasure.UNIT,
  })
  unit: UnitOfMeasure | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  brand: string | null;

  // --- inventario (solo relevante para artículos tipo producto) ---
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

  @OneToMany(() => ProductPurchase, (purchase) => purchase.article)
  purchases: ProductPurchase[];

  @OneToMany(() => ConsumptionCycle, (cycle) => cycle.article)
  consumptionCycles: ConsumptionCycle[];

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
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
import { User } from '../../users/entities/user.entity';
import { ProductPurchase } from './product-purchase.entity';

// ciclo de consumo: desde "lo empecé a usar" hasta "se acabó"
@ObjectType()
@Entity('consumption_cycles')
@Check(
  'cycles_date_order',
  '"depleted_on" IS NULL OR "depleted_on" >= "started_on"',
)
@Check('consumption_cycles_quantity_check', '"quantity" > 0')
@Index('idx_cycles_article', ['articleId', 'startedOn'])
@Index('idx_cycles_one_open', ['articleId'], {
  unique: true,
  where: '"depleted_on" IS NULL',
})
export class ConsumptionCycle {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.consumptionCycles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => Article)
  @ManyToOne(() => Article, (article) => article.consumptionCycles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'article_id' })
  article: Article;

  @Field(() => ID)
  @Column({ name: 'article_id', type: 'uuid' })
  articleId: string;

  @ManyToOne(() => ProductPurchase, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'purchase_id' })
  purchase: ProductPurchase | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'purchase_id', type: 'uuid', nullable: true })
  purchaseId: string | null;

  @Field()
  @Column({ name: 'started_on', type: 'date' })
  startedOn: string;

  // null = todavía en uso
  @Field(() => String, { nullable: true })
  @Column({ name: 'depleted_on', type: 'date', nullable: true })
  depletedOn: string | null;

  @Field(() => Int, { nullable: true })
  @Column({
    name: 'days_lasted',
    type: 'integer',
    generatedType: 'STORED',
    asExpression: '"depleted_on" - "started_on"',
    nullable: true,
  })
  daysLasted: number | null;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 1,
    transformer: new NumericTransformer(),
  })
  quantity: number;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

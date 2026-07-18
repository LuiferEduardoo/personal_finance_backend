import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TransactionKind } from '../../common/enums/transaction-kind.enum';
import { User } from '../../users/entities/user.entity';

@ObjectType()
@Entity('categories')
@Unique('categories_name_unique', ['userId', 'parentId', 'name'])
@Check('categories_no_self_ref', '"id" <> "parent_id"')
@Index('idx_categories_user', ['userId', 'kind'], { where: '"is_active"' })
export class Category {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // null = categoría global del sistema, visible para todos los usuarios
  @ManyToOne(() => User, (user) => user.categories, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Field(() => ID, {
    nullable: true,
    description: 'null = categoría del sistema',
  })
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => Category, (category) => category.children, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: Category | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @OneToMany(() => Category, (category) => category.parent)
  children: Category[];

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => TransactionKind)
  @Column({
    type: 'enum',
    enum: TransactionKind,
    enumName: 'transaction_kind',
  })
  kind: TransactionKind;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  icon: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  color: string | null;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

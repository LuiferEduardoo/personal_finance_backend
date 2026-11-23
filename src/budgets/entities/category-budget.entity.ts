import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';

// presupuesto mensual de un usuario para una categoría de gasto. Vive en su
// propia tabla (y no en categories) porque las categorías del sistema son
// globales: cada usuario les pone su propio monto. El gasto del mes incluye
// las subcategorías de la categoría.
@Entity('category_budgets')
@Unique('category_budgets_category_unique', ['userId', 'categoryId'])
@Check('category_budgets_amount_check', '"amount" > 0')
export class CategoryBudget {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_category_budgets',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_category_budgets_user',
  })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_category_budgets_category',
  })
  category: Category;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Column({ type: 'char', length: 3, default: 'COP' })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { CategoryBudget } from './category-budget.entity';

// aviso enviado por superar un presupuesto en un mes. El índice único
// (budget, period) es el cerrojo: solo quien logra insertar la fila envía el
// correo, así dos gastos simultáneos no duplican el aviso.
@Entity('category_budget_alerts')
@Unique('category_budget_alerts_period_unique', ['budgetId', 'period'])
export class CategoryBudgetAlert {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_category_budget_alerts',
  })
  id: string;

  @ManyToOne(() => CategoryBudget, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'budget_id',
    foreignKeyConstraintName: 'FK_category_budget_alerts_budget',
  })
  budget: CategoryBudget;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId: string;

  // mes del aviso, "YYYY-MM"
  @Column({ type: 'char', length: 7 })
  period: string;

  // gasto del mes (moneda base) al momento del aviso
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  spent: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

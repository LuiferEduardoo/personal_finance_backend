import {
  Column,
  Entity,
  JoinColumn,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Expense } from '../../transactions/entities/expense.entity';
import { Income } from '../../transactions/entities/income.entity';
import { User } from '../../users/entities/user.entity';

@Entity('tags')
@Unique('tags_name_unique', ['userId', 'name'])
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.tags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  name: string;

  @ManyToMany(() => Expense, (expense) => expense.tags)
  expenses: Expense[];

  @ManyToMany(() => Income, (income) => income.tags)
  incomes: Income[];
}

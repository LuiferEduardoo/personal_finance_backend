import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Authentication } from '../../auth/entities/authentication.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { Category } from '../../categories/entities/category.entity';
import { InstallmentPlan } from '../../installments/entities/installment-plan.entity';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { ConsumptionCycle } from '../../products/entities/consumption-cycle.entity';
import { ProductPurchase } from '../../products/entities/product-purchase.entity';
import { Product } from '../../products/entities/product.entity';
import { ShoppingList } from '../../shopping-lists/entities/shopping-list.entity';
import { Tag } from '../../tags/entities/tag.entity';
import { Expense } from '../../transactions/entities/expense.entity';
import { Income } from '../../transactions/entities/income.entity';

@ObjectType()
@Entity('users')
export class User {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Index({ unique: true })
  @Column()
  email: string;

  @Field()
  @Column({ name: 'first_name' })
  firstName: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Field()
  @Column({ name: 'base_currency', type: 'char', length: 3, default: 'COP' })
  baseCurrency: string;

  @Field()
  @Column({ type: 'text', default: 'America/Bogota' })
  timezone: string;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field(() => Authentication, { nullable: true })
  @OneToOne(() => Authentication, (authentication) => authentication.user)
  authentication: Authentication;

  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refreshTokens: RefreshToken[];

  @OneToMany(() => Category, (category) => category.user)
  categories: Category[];

  @OneToMany(() => PaymentMethod, (paymentMethod) => paymentMethod.user)
  paymentMethods: PaymentMethod[];

  @OneToMany(() => InstallmentPlan, (plan) => plan.user)
  installmentPlans: InstallmentPlan[];

  @OneToMany(() => Expense, (expense) => expense.user)
  expenses: Expense[];

  @OneToMany(() => Income, (income) => income.user)
  incomes: Income[];

  @OneToMany(() => Tag, (tag) => tag.user)
  tags: Tag[];

  @OneToMany(() => Product, (product) => product.user)
  products: Product[];

  @OneToMany(() => ProductPurchase, (purchase) => purchase.user)
  productPurchases: ProductPurchase[];

  @OneToMany(() => ConsumptionCycle, (cycle) => cycle.user)
  consumptionCycles: ConsumptionCycle[];

  @OneToMany(() => ShoppingList, (list) => list.user)
  shoppingLists: ShoppingList[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}

import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import { Category } from '../../categories/entities/category.entity';

@ObjectType({
  description:
    'Presupuesto mensual de una categoría con lo gastado en el mes (incluye subcategorías)',
})
export class CategoryBudgetStatus {
  @Field(() => ID)
  id: string;

  @Field(() => Category)
  category: Category;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;

  @Field({ description: 'Mes evaluado (YYYY-MM)' })
  period: string;

  @Field(() => Float, { description: 'Gastado en el mes, en moneda base' })
  spent: number;

  @Field(() => Float, {
    description: 'amount - spent; negativo si se excedió',
  })
  remaining: number;

  @Field(() => Float, { description: 'spent / amount * 100' })
  percentage: number;

  @Field()
  exceeded: boolean;
}

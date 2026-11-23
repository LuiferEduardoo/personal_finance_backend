import { Field, Float, ID, InputType } from '@nestjs/graphql';

@InputType()
export class SetCategoryBudgetInput {
  @Field(() => ID, { description: 'Categoría de gasto (propia o del sistema)' })
  categoryId: string;

  @Field(() => Float, { description: 'Tope mensual, mayor que 0' })
  amount: number;

  @Field({
    nullable: true,
    description:
      'Opcional; debe ser la moneda base del usuario (es la que se usa por defecto)',
  })
  currency?: string;
}

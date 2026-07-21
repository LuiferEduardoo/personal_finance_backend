import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class InflationFilterInput {
  @Field({
    nullable: true,
    description: 'Mes inicial YYYY-MM (inclusive). Por defecto, el primer gasto',
  })
  from?: string;

  @Field({
    nullable: true,
    description: 'Mes final YYYY-MM (inclusive). Por defecto, el mes actual',
  })
  to?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Calcular solo sobre una categoría (incluye sus subcategorías)',
  })
  categoryId?: string;
}

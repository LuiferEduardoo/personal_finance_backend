import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { CreateProductInput } from './create-product.input';

@InputType()
export class RegisterProductPurchaseInput {
  @Field(() => ID, {
    nullable: true,
    description: 'Producto existente del catálogo',
  })
  productId?: string;

  @Field(() => CreateProductInput, {
    nullable: true,
    description:
      'Crear el producto en el catálogo en la misma compra (si no existe aún)',
  })
  newProduct?: CreateProductInput;

  @Field(() => Float, { nullable: true, defaultValue: 1 })
  quantity?: number;

  @Field(() => Float, { nullable: true })
  unitPrice?: number;

  @Field({ nullable: true })
  store?: string;

  @Field({ description: 'Fecha de compra (YYYY-MM-DD)' })
  purchasedOn: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Gasto asociado (ej. la ida al supermercado)',
  })
  expenseId?: string;

  @Field({ nullable: true })
  notes?: string;
}

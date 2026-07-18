import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { UnitOfMeasure } from '../entities/product.entity';

@InputType()
export class CreateProductInput {
  @Field()
  name: string;

  @Field({ nullable: true })
  brand?: string;

  @Field(() => Float, { nullable: true })
  packageSize?: number;

  @Field(() => UnitOfMeasure, {
    nullable: true,
    defaultValue: UnitOfMeasure.UNIT,
  })
  unit?: UnitOfMeasure;

  @Field({ nullable: true })
  barcode?: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field({
    nullable: true,
    defaultValue: true,
    description: 'false = bien durable, sin ciclo de agotamiento',
  })
  isConsumable?: boolean;

  @Field({ nullable: true })
  notes?: string;
}

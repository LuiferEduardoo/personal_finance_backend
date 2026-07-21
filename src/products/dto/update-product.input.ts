import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';

// edita un artículo tipo producto (los campos de inventario viven en Article)
@InputType()
export class UpdateProductInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  brand?: string;

  @Field(() => Float, { nullable: true })
  packageSize?: number;

  @Field(() => UnitOfMeasure, { nullable: true })
  unit?: UnitOfMeasure;

  @Field({ nullable: true })
  barcode?: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string;

  @Field({ nullable: true })
  isConsumable?: boolean;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

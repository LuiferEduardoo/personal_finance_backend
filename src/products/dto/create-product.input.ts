import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';

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

  @Field(() => ID, {
    nullable: true,
    description: 'Artículo (catálogo general) al que pertenece este producto',
  })
  articleId?: string;

  @Field({
    nullable: true,
    defaultValue: true,
    description: 'false = bien durable, sin ciclo de agotamiento',
  })
  isConsumable?: boolean;

  @Field({ nullable: true })
  notes?: string;
}

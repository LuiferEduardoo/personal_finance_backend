import { Field, Float, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { TrmService } from './trm.service';

@ObjectType()
class TrmQuote {
  @Field(() => Float) value: number;
  @Field() validFrom: string;
  @Field() validTo: string;
}

@Resolver()
export class TrmResolver {
  constructor(private readonly trm: TrmService) {}
  @Query(() => TrmQuote, { description: 'Última TRM oficial USD/COP' })
  latestTrm() {
    return this.trm.latest();
  }
}

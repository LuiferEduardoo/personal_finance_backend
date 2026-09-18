import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { ApiScope } from '../common/enums/api-scope.enum';
import { InflationFilterInput } from './dto/inflation-filter.input';
import { InflationReport } from './dto/inflation.type';
import { InflationService } from './inflation.service';

@Resolver(() => InflationReport)
@UseGuards(GqlAuthGuard)
export class InflationResolver {
  constructor(private readonly inflationService: InflationService) {}

  @Query(() => InflationReport, {
    description:
      'Inflación personal sobre los gastos: variación mensual y anual del gasto del usuario',
  })
  @Scopes(ApiScope.INFLATION_READ)
  expenseInflation(
    @CurrentUser() user: JwtPayload,
    @Args('filter', { nullable: true }) filter?: InflationFilterInput,
  ): Promise<InflationReport> {
    return this.inflationService.expenseInflation(user.sub, filter);
  }
}

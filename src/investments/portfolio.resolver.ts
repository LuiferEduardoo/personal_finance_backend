import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import {
  AllocationDimension,
  InvestmentPositionsFilterInput,
} from './dto/investments-filter.input';
import {
  PortfolioAllocation,
  PortfolioSummary,
  PositionView,
} from './dto/portfolio.type';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';

@Resolver(() => PortfolioSummary)
@UseGuards(GqlAuthGuard)
export class PortfolioResolver {
  constructor(private readonly analytics: PortfolioAnalyticsService) {}

  @Query(() => [PositionView], {
    description: 'Posiciones abiertas valoradas a precio de mercado',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentPositions(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true }) filter?: InvestmentPositionsFilterInput,
  ): Promise<PositionView[]> {
    return this.analytics.positions(user.sub, filter);
  }

  @Query(() => PortfolioSummary, {
    description:
      'Resumen de la cartera: patrimonio invertido, valor actual, capital aportado y P&L',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  portfolioSummary(
    @CurrentUser() user: Principal,
    @Args('asOf', { nullable: true, description: 'YYYY-MM-DD' }) asOf?: string,
  ): Promise<PortfolioSummary> {
    return this.analytics.summary(user.sub, asOf);
  }

  @Query(() => PortfolioAllocation, {
    description:
      'Distribución de la cartera por bróker, activo, sector, país, moneda o tipo de activo',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  portfolioAllocation(
    @CurrentUser() user: Principal,
    @Args('dimension', { type: () => AllocationDimension })
    dimension: AllocationDimension,
    @Args('asOf', { nullable: true, description: 'YYYY-MM-DD' }) asOf?: string,
  ): Promise<PortfolioAllocation> {
    return this.analytics.allocation(user.sub, dimension, asOf);
  }
}

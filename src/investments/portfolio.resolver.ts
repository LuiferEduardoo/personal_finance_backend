import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { BenchmarkKey } from '../market-data/entities/instrument.entity';
import { PricesService } from '../market-data/prices.service';
import { BenchmarksService } from './benchmarks.service';
import { BenchmarkComparison } from './dto/benchmark-comparison.type';
import {
  AllocationDimension,
  InvestmentPositionsFilterInput,
} from './dto/investments-filter.input';
import { PortfolioEvolution } from './dto/portfolio-evolution.type';
import { PortfolioReturns } from './dto/portfolio-returns.type';
import {
  PortfolioAllocation,
  PortfolioSummary,
  PositionView,
} from './dto/portfolio.type';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';
import { SnapshotsService } from './snapshots.service';

@Resolver(() => PortfolioSummary)
@UseGuards(GqlAuthGuard)
export class PortfolioResolver {
  constructor(
    private readonly analytics: PortfolioAnalyticsService,
    private readonly snapshotsService: SnapshotsService,
    private readonly benchmarksService: BenchmarksService,
    private readonly pricesService: PricesService,
  ) {}

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

  @Query(() => PortfolioEvolution, {
    description:
      'Evolución histórica del patrimonio, día a día, con el índice TWR encadenado',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  portfolioEvolution(
    @CurrentUser() user: Principal,
    @Args('from', { nullable: true, description: 'YYYY-MM-DD' }) from?: string,
    @Args('to', { nullable: true, description: 'YYYY-MM-DD' }) to?: string,
  ): Promise<PortfolioEvolution> {
    return this.analytics.evolution(user.sub, from, to);
  }

  @Query(() => PortfolioReturns, {
    description:
      'Rentabilidad simple, TWR (anualizado) y XIRR/MWR. Responden preguntas distintas.',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  portfolioReturns(
    @CurrentUser() user: Principal,
    @Args('from', { nullable: true, description: 'YYYY-MM-DD' }) from?: string,
    @Args('to', { nullable: true, description: 'YYYY-MM-DD' }) to?: string,
  ): Promise<PortfolioReturns> {
    return this.analytics.returns(user.sub, from, to);
  }

  @Query(() => BenchmarkComparison, {
    description:
      'Compara la curva TWR de la cartera contra S&P 500, Nasdaq-100 o MSCI World',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  benchmarkComparison(
    @CurrentUser() user: Principal,
    @Args('benchmarks', { type: () => [BenchmarkKey] })
    benchmarks: BenchmarkKey[],
    @Args('from', { nullable: true, description: 'YYYY-MM-DD' }) from?: string,
    @Args('to', { nullable: true, description: 'YYYY-MM-DD' }) to?: string,
    @Args('inBaseCurrency', {
      nullable: true,
      defaultValue: true,
      description:
        'Convierte el índice a tu moneda base antes de normalizar. Comparar un S&P 500 sin convertir da un número materialmente equivocado.',
    })
    inBaseCurrency?: boolean,
  ): Promise<BenchmarkComparison> {
    return this.benchmarksService.compare(
      user.sub,
      benchmarks,
      from,
      to,
      inBaseCurrency ?? true,
    );
  }

  @Mutation(() => String, {
    description:
      'Refresca precios y tasas desde Twelve Data y reconstruye los snapshots. ' +
      'Respeta el presupuesto diario: si se agota, para y retoma en el siguiente ciclo.',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  async refreshInvestmentPrices(
    @CurrentUser() user: Principal,
  ): Promise<string> {
    // se mide el presupuesto ANTES de todo para que el total de créditos
    // reportado incluya también las tasas y los benchmarks, no solo los precios
    const creditsBefore = await this.pricesService.remainingCredits();
    const prices = await this.pricesService.refreshPrices(user.sub);
    const fxRates = await this.snapshotsService.ensureFxRates(user.sub);
    // los benchmarks tienen que cubrir el mismo rango que la cartera, o la
    // comparación sale truncada
    const firstDate = await this.snapshotsService.firstActivityDate(user.sub);
    const benchmarkBars = firstDate
      ? await this.pricesService.ensureBenchmarkHistory(firstDate)
      : 0;
    const snapshots = await this.snapshotsService.buildSnapshots(
      undefined,
      user.sub,
    );
    const creditsUsed = Math.max(
      0,
      creditsBefore - (await this.pricesService.remainingCredits()),
    );
    const parts = [
      `${prices.refreshed} barras`,
      `${prices.backfilled} backfills`,
      `${fxRates} tasas de cambio`,
      `${benchmarkBars} barras de benchmark`,
      `${creditsUsed} créditos`,
      `${snapshots.days} días de snapshot`,
    ];
    if (prices.budgetExhausted) {
      parts.push('presupuesto diario agotado');
    }
    if (prices.errors.length > 0) {
      parts.push(`errores: ${prices.errors.join('; ')}`);
    }
    return parts.join(', ');
  }

  @Mutation(() => String, {
    description:
      'Reconstruye la serie diaria de la cartera sin llamar al proveedor de precios',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  async rebuildPortfolioSnapshots(
    @CurrentUser() user: Principal,
  ): Promise<string> {
    const report = await this.snapshotsService.buildSnapshots(
      undefined,
      user.sub,
    );
    return `${report.days} días reconstruidos, ${report.estimatedDays} estimados`;
  }
}

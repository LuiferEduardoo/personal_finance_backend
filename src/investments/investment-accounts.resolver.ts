import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import {
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
} from './dto/investment-account.input';
import { InvestmentAccount } from './entities/investment-account.entity';
import { InvestmentCashBalance } from './entities/investment-cash-balance.entity';
import { InvestmentAccountsService } from './investment-accounts.service';
import { PositionsService } from './positions.service';

@Resolver(() => InvestmentAccount)
@UseGuards(GqlAuthGuard)
export class InvestmentAccountsResolver {
  constructor(
    private readonly accountsService: InvestmentAccountsService,
    private readonly positionsService: PositionsService,
  ) {}

  @Query(() => [InvestmentAccount], {
    description: 'Cuentas de inversión del usuario',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentAccounts(
    @CurrentUser() user: Principal,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<InvestmentAccount[]> {
    return this.accountsService.findAll(user.sub, includeInactive);
  }

  @Query(() => InvestmentAccount)
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentAccount(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InvestmentAccount> {
    return this.accountsService.findOne(id, user.sub);
  }

  @Query(() => [InvestmentCashBalance], {
    description: 'Saldos de efectivo por moneda',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentCashBalances(
    @CurrentUser() user: Principal,
    @Args('accountId', { type: () => ID, nullable: true }) accountId?: string,
  ): Promise<InvestmentCashBalance[]> {
    return this.accountsService.findCashBalances(user.sub, accountId);
  }

  @Mutation(() => InvestmentAccount)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  createInvestmentAccount(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateInvestmentAccountInput,
  ): Promise<InvestmentAccount> {
    return this.accountsService.create(user.sub, input);
  }

  @Mutation(() => InvestmentAccount)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  updateInvestmentAccount(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateInvestmentAccountInput,
  ): Promise<InvestmentAccount> {
    return this.accountsService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  deleteInvestmentAccount(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.accountsService.remove(id, user.sub);
  }

  @Mutation(() => Boolean, {
    description:
      'Recalcula lotes, posiciones y efectivo desde el libro de operaciones. ' +
      'Válvula manual: el resultado debe coincidir con el camino incremental.',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  async rebuildInvestmentPositions(
    @CurrentUser() user: Principal,
    @Args('accountId', { type: () => ID, nullable: true }) accountId?: string,
  ): Promise<boolean> {
    await this.positionsService.rebuildAll(user.sub, accountId);
    return true;
  }
}

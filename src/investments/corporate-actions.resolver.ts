import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { CorporateActionsService } from '../market-data/corporate-actions.service';
import { InvestmentCorporateActionsService } from './corporate-actions.service';
import { PendingCorporateAction } from './dto/corporate-action.type';
import { InvestmentTransaction } from './entities/investment-transaction.entity';

@Resolver(() => PendingCorporateAction)
@UseGuards(GqlAuthGuard)
export class CorporateActionsResolver {
  constructor(
    private readonly service: InvestmentCorporateActionsService,
    private readonly marketActions: CorporateActionsService,
  ) {}

  @Query(() => [PendingCorporateAction], {
    description:
      'Dividendos y splits anunciados que te afectaban y NO tienes en el libro. ' +
      'Es una sugerencia: nada se registra solo.',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  pendingCorporateActions(
    @CurrentUser() user: Principal,
  ): Promise<PendingCorporateAction[]> {
    return this.service.pending(user.sub);
  }

  @Mutation(() => InvestmentTransaction, {
    description:
      'Registra la operación correspondiente a una acción corporativa que confirmes que te falta',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  applyCorporateAction(
    @CurrentUser() user: Principal,
    @Args('actionId', { type: () => ID }) actionId: string,
    @Args('accountId', { type: () => ID }) accountId: string,
  ): Promise<InvestmentTransaction> {
    return this.service.apply(user.sub, actionId, accountId);
  }

  @Mutation(() => String, {
    description:
      'Descarga dividendos y splits anunciados de los instrumentos en cartera (2 créditos por instrumento)',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  async refreshCorporateActions(
    @CurrentUser() user: Principal,
  ): Promise<string> {
    void user;
    const report = await this.marketActions.refresh();
    const parts = [
      `${report.instruments} instrumento(s)`,
      `${report.dividends} dividendo(s)`,
      `${report.splits} split(s)`,
    ];
    if (report.budgetExhausted) {
      parts.push('presupuesto diario agotado');
    }
    return parts.join(', ');
  }
}

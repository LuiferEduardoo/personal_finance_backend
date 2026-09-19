import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import {
  CreateInvestmentTransactionInput,
  SetLotCostBasisInput,
  UpdateInvestmentTransactionInput,
} from './dto/investment-transaction.input';
import { InvestmentTransactionsFilterInput } from './dto/investments-filter.input';
import { InvestmentLot } from './entities/investment-lot.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';
import { InvestmentTransactionsService } from './investment-transactions.service';

@Resolver(() => InvestmentTransaction)
@UseGuards(GqlAuthGuard)
export class InvestmentTransactionsResolver {
  constructor(
    private readonly transactionsService: InvestmentTransactionsService,
  ) {}

  @Query(() => [InvestmentTransaction], {
    description:
      'Operaciones de inversión. Paginado: el histórico de un bróker pasa fácil de 20 000 filas.',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentTransactions(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true })
    filter?: InvestmentTransactionsFilterInput,
  ): Promise<InvestmentTransaction[]> {
    return this.transactionsService.findAll(user.sub, filter);
  }

  @Query(() => Int, {
    description: 'Total de operaciones que cumplen el filtro',
  })
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentTransactionsCount(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true })
    filter?: InvestmentTransactionsFilterInput,
  ): Promise<number> {
    return this.transactionsService.count(user.sub, filter);
  }

  @Query(() => InvestmentTransaction)
  @Scopes(ApiScope.INVESTMENTS_READ)
  investmentTransaction(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InvestmentTransaction> {
    return this.transactionsService.findOne(id, user.sub);
  }

  @Mutation(() => InvestmentTransaction, {
    description:
      'Registra una operación. Reconstruye lotes y posiciones en la misma transacción.',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  createInvestmentTransaction(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateInvestmentTransactionInput,
  ): Promise<InvestmentTransaction> {
    return this.transactionsService.create(user.sub, input);
  }

  @Mutation(() => InvestmentTransaction)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  updateInvestmentTransaction(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateInvestmentTransactionInput,
  ): Promise<InvestmentTransaction> {
    return this.transactionsService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  deleteInvestmentTransaction(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.transactionsService.remove(id, user.sub);
  }

  @Mutation(() => InvestmentLot, {
    description:
      'Corrige la base de costo de un lote estimado (típico de un TRANSFER_IN sin precio)',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  setLotCostBasis(
    @CurrentUser() user: Principal,
    @Args('input') input: SetLotCostBasisInput,
  ): Promise<InvestmentLot> {
    return this.transactionsService.setLotCostBasis(user.sub, input);
  }

  @Mutation(() => Int, {
    description:
      'Re-resuelve la tasa de cambio de las operaciones que se guardaron con tasa 1 ' +
      'por no existir todavía caché de tasas. Respeta las tasas escritas a mano. ' +
      'Devuelve cuántas se corrigieron.',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  resolveInvestmentFxRates(@CurrentUser() user: Principal): Promise<number> {
    return this.transactionsService.resolveMissingFxRates(user.sub);
  }
}

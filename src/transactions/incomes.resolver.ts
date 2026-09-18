import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { CreateIncomeInput } from './dto/create-income.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateIncomeInput } from './dto/update-income.input';
import { Income } from './entities/income.entity';
import { IncomesService } from './incomes.service';

@Resolver(() => Income)
@UseGuards(GqlAuthGuard)
export class IncomesResolver {
  constructor(private readonly incomesService: IncomesService) {}

  @Query(() => [Income])
  @Scopes(ApiScope.INCOMES_READ)
  incomes(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true }) filter?: TransactionsFilterInput,
  ): Promise<Income[]> {
    return this.incomesService.findAll(user.sub, filter);
  }

  @Query(() => Income)
  @Scopes(ApiScope.INCOMES_READ)
  income(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Income> {
    return this.incomesService.findOne(id, user.sub);
  }

  @Mutation(() => Income)
  @Scopes(ApiScope.INCOMES_WRITE)
  createIncome(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateIncomeInput,
  ): Promise<Income> {
    return this.incomesService.create(user.sub, input);
  }

  @Mutation(() => Income)
  @Scopes(ApiScope.INCOMES_WRITE)
  updateIncome(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateIncomeInput,
  ): Promise<Income> {
    return this.incomesService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.INCOMES_WRITE)
  removeIncome(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.incomesService.remove(id, user.sub);
  }
}

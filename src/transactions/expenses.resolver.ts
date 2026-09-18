import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { CreateExpenseInput } from './dto/create-expense.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { Expense } from './entities/expense.entity';
import { ExpensesService } from './expenses.service';

@Resolver(() => Expense)
@UseGuards(GqlAuthGuard)
export class ExpensesResolver {
  constructor(private readonly expensesService: ExpensesService) {}

  @Query(() => [Expense])
  @Scopes(ApiScope.EXPENSES_READ)
  expenses(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true }) filter?: TransactionsFilterInput,
  ): Promise<Expense[]> {
    return this.expensesService.findAll(user.sub, filter);
  }

  @Query(() => Expense)
  @Scopes(ApiScope.EXPENSES_READ)
  expense(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Expense> {
    return this.expensesService.findOne(id, user.sub);
  }

  @Mutation(() => Expense)
  @Scopes(ApiScope.EXPENSES_WRITE)
  createExpense(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateExpenseInput,
  ): Promise<Expense> {
    return this.expensesService.create(user.sub, input);
  }

  @Mutation(() => Expense)
  @Scopes(ApiScope.EXPENSES_WRITE)
  updateExpense(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateExpenseInput,
  ): Promise<Expense> {
    return this.expensesService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.EXPENSES_WRITE)
  removeExpense(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.expensesService.remove(id, user.sub);
  }
}

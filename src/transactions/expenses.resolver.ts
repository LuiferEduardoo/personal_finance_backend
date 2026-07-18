import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CreateExpenseInput } from './dto/create-expense.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { Expense } from './entities/expense.entity';
import { ExpensesService } from './expenses.service';

@Resolver(() => Expense)
export class ExpensesResolver {
  constructor(private readonly expensesService: ExpensesService) {}

  @Query(() => [Expense])
  expenses(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('filter', { nullable: true }) filter?: TransactionsFilterInput,
  ): Promise<Expense[]> {
    return this.expensesService.findAll(userId, filter);
  }

  @Query(() => Expense)
  expense(@Args('id', { type: () => ID }) id: string): Promise<Expense> {
    return this.expensesService.findOne(id);
  }

  @Mutation(() => Expense)
  createExpense(@Args('input') input: CreateExpenseInput): Promise<Expense> {
    return this.expensesService.create(input);
  }

  @Mutation(() => Expense)
  updateExpense(@Args('input') input: UpdateExpenseInput): Promise<Expense> {
    return this.expensesService.update(input);
  }

  @Mutation(() => Boolean)
  removeExpense(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.expensesService.remove(id);
  }
}

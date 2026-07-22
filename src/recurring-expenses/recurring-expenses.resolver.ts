import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CreateRecurringExpenseInput } from './dto/create-recurring-expense.input';
import { UpdateRecurringExpenseInput } from './dto/update-recurring-expense.input';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { RecurringExpensesService } from './recurring-expenses.service';

@Resolver(() => RecurringExpense)
@UseGuards(GqlAuthGuard)
export class RecurringExpensesResolver {
  constructor(
    private readonly recurringExpensesService: RecurringExpensesService,
  ) {}

  @Query(() => [RecurringExpense], {
    description: 'Plantillas de gastos recurrentes del usuario',
  })
  recurringExpenses(
    @CurrentUser() user: JwtPayload,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<RecurringExpense[]> {
    return this.recurringExpensesService.findAll(user.sub, includeInactive);
  }

  @Mutation(() => RecurringExpense)
  createRecurringExpense(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: CreateRecurringExpenseInput,
  ): Promise<RecurringExpense> {
    return this.recurringExpensesService.create(user.sub, input);
  }

  @Mutation(() => RecurringExpense)
  updateRecurringExpense(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateRecurringExpenseInput,
  ): Promise<RecurringExpense> {
    return this.recurringExpensesService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  removeRecurringExpense(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.recurringExpensesService.remove(id, user.sub);
  }

  @Mutation(() => Int, {
    description:
      'Genera los gastos recurrentes vencidos (lo hace también un job diario). Devuelve cuántos se crearon.',
  })
  runDueRecurringExpenses(): Promise<number> {
    return this.recurringExpensesService.runDue();
  }
}

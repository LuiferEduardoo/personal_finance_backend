import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CreateIncomeInput } from './dto/create-income.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateIncomeInput } from './dto/update-income.input';
import { Income } from './entities/income.entity';
import { IncomesService } from './incomes.service';

@Resolver(() => Income)
export class IncomesResolver {
  constructor(private readonly incomesService: IncomesService) {}

  @Query(() => [Income])
  incomes(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('filter', { nullable: true }) filter?: TransactionsFilterInput,
  ): Promise<Income[]> {
    return this.incomesService.findAll(userId, filter);
  }

  @Query(() => Income)
  income(@Args('id', { type: () => ID }) id: string): Promise<Income> {
    return this.incomesService.findOne(id);
  }

  @Mutation(() => Income)
  createIncome(@Args('input') input: CreateIncomeInput): Promise<Income> {
    return this.incomesService.create(input);
  }

  @Mutation(() => Income)
  updateIncome(@Args('input') input: UpdateIncomeInput): Promise<Income> {
    return this.incomesService.update(input);
  }

  @Mutation(() => Boolean)
  removeIncome(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.incomesService.remove(id);
  }
}

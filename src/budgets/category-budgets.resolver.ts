import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { CategoryBudgetsService } from './category-budgets.service';
import { CategoryBudgetStatus } from './dto/category-budget-status';
import { SetCategoryBudgetInput } from './dto/set-category-budget.input';

// los presupuestos son configuración de las categorías: usan sus mismos scopes
@Resolver(() => CategoryBudgetStatus)
@UseGuards(GqlAuthGuard)
export class CategoryBudgetsResolver {
  constructor(private readonly budgetsService: CategoryBudgetsService) {}

  @Query(() => [CategoryBudgetStatus], {
    description:
      'Presupuestos mensuales por categoría con lo gastado en el mes (por defecto, el actual)',
  })
  @Scopes(ApiScope.CATEGORIES_READ)
  categoryBudgets(
    @CurrentUser() user: Principal,
    @Args('month', {
      nullable: true,
      description: 'Mes a evaluar (YYYY-MM); por defecto el actual',
    })
    month?: string,
  ): Promise<CategoryBudgetStatus[]> {
    return this.budgetsService.findAll(user.sub, month);
  }

  @Mutation(() => CategoryBudgetStatus, {
    description: 'Crea o actualiza el presupuesto mensual de una categoría',
  })
  @Scopes(ApiScope.CATEGORIES_WRITE)
  setCategoryBudget(
    @CurrentUser() user: Principal,
    @Args('input') input: SetCategoryBudgetInput,
  ): Promise<CategoryBudgetStatus> {
    return this.budgetsService.set(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.CATEGORIES_WRITE)
  removeCategoryBudget(
    @CurrentUser() user: Principal,
    @Args('categoryId', { type: () => ID }) categoryId: string,
  ): Promise<boolean> {
    return this.budgetsService.remove(user.sub, categoryId);
  }
}

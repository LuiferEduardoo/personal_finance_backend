import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import { CategoriesService } from './categories.service';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';
import { Category } from './entities/category.entity';

@Resolver(() => Category)
@UseGuards(GqlAuthGuard)
export class CategoriesResolver {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Query(() => [Category], {
    description: 'Categorías del sistema + las del usuario',
  })
  @Scopes(ApiScope.CATEGORIES_READ)
  categories(
    @CurrentUser() user: Principal,
    @Args('kind', { type: () => TransactionKind, nullable: true })
    kind?: TransactionKind,
  ): Promise<Category[]> {
    return this.categoriesService.findAll(user.sub, kind);
  }

  @Query(() => Category)
  @Scopes(ApiScope.CATEGORIES_READ)
  category(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Category> {
    return this.categoriesService.findOne(id, user.sub);
  }

  @Mutation(() => Category)
  @Scopes(ApiScope.CATEGORIES_WRITE)
  createCategory(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateCategoryInput,
  ): Promise<Category> {
    return this.categoriesService.create(user.sub, input);
  }

  @Mutation(() => Category)
  @Scopes(ApiScope.CATEGORIES_WRITE)
  updateCategory(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateCategoryInput,
  ): Promise<Category> {
    return this.categoriesService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.CATEGORIES_WRITE)
  removeCategory(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.categoriesService.remove(id, user.sub);
  }
}

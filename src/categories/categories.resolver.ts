import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import { CategoriesService } from './categories.service';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';
import { Category } from './entities/category.entity';

@Resolver(() => Category)
export class CategoriesResolver {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Query(() => [Category], {
    description: 'Categorías del sistema + las del usuario',
  })
  categories(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('kind', { type: () => TransactionKind, nullable: true })
    kind?: TransactionKind,
  ): Promise<Category[]> {
    return this.categoriesService.findAll(userId, kind);
  }

  @Query(() => Category)
  category(@Args('id', { type: () => ID }) id: string): Promise<Category> {
    return this.categoriesService.findOne(id);
  }

  @Mutation(() => Category)
  createCategory(
    @Args('input') input: CreateCategoryInput,
  ): Promise<Category> {
    return this.categoriesService.create(input);
  }

  @Mutation(() => Category)
  updateCategory(
    @Args('input') input: UpdateCategoryInput,
  ): Promise<Category> {
    return this.categoriesService.update(input);
  }

  @Mutation(() => Boolean)
  removeCategory(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.categoriesService.remove(id);
  }
}

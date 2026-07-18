import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CreateProductInput } from './dto/create-product.input';
import { UpdateProductInput } from './dto/update-product.input';
import { ProductStatsView } from './entities/product-stats.view';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

@Resolver(() => Product)
@UseGuards(GqlAuthGuard)
export class ProductsResolver {
  constructor(private readonly productsService: ProductsService) {}

  @Query(() => [Product], { description: 'Catálogo de productos del usuario' })
  products(
    @CurrentUser() user: JwtPayload,
    @Args('search', { nullable: true }) search?: string,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<Product[]> {
    return this.productsService.findAll(user.sub, search, includeInactive);
  }

  @Query(() => Product)
  product(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Product> {
    return this.productsService.findOne(id, user.sub);
  }

  @Query(() => [ProductStatsView], {
    description:
      'Estadísticas por producto: duración promedio, costo y fecha estimada de agotamiento',
  })
  productStats(@CurrentUser() user: JwtPayload): Promise<ProductStatsView[]> {
    return this.productsService.productStats(user.sub);
  }

  @Mutation(() => Product)
  createProduct(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: CreateProductInput,
  ): Promise<Product> {
    return this.productsService.create(user.sub, input);
  }

  @Mutation(() => Product)
  updateProduct(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateProductInput,
  ): Promise<Product> {
    return this.productsService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  removeProduct(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.productsService.remove(id, user.sub);
  }
}

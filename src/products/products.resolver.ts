import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Article } from '../articles/entities/article.entity';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { UpdateProductInput } from './dto/update-product.input';
import { ProductStatsView } from './entities/product-stats.view';
import { ProductsService } from './products.service';
import { PurchasesService } from './purchases.service';

// "producto" es la vista de inventario de un artículo tipo PRODUCT.
// Resuelve el campo inStock del tipo Article (por eso vive aquí, junto a
// PurchasesService, y no en ArticlesModule — evita un ciclo de módulos).
@Resolver(() => Article)
@UseGuards(GqlAuthGuard)
export class ProductsResolver {
  constructor(
    private readonly productsService: ProductsService,
    private readonly purchasesService: PurchasesService,
  ) {}

  @ResolveField(() => Boolean, {
    description:
      '"hay producto": tiene un ciclo de consumo abierto (comprado y sin agotar)',
  })
  inStock(@Parent() article: Article): Promise<boolean> {
    return this.purchasesService.hasOpenCycle(article.id);
  }

  @Query(() => [Article], {
    description: 'Catálogo de productos (artículos tipo producto) del usuario',
  })
  products(
    @CurrentUser() user: JwtPayload,
    @Args('search', { nullable: true }) search?: string,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<Article[]> {
    return this.productsService.findAll(user.sub, search, includeInactive);
  }

  @Query(() => Article)
  product(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Article> {
    return this.productsService.findOne(id, user.sub);
  }

  @Query(() => [ProductStatsView], {
    description:
      'Estadísticas por producto: duración promedio, costo y fecha estimada de agotamiento',
  })
  productStats(@CurrentUser() user: JwtPayload): Promise<ProductStatsView[]> {
    return this.productsService.productStats(user.sub);
  }

  @Mutation(() => Article)
  updateProduct(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateProductInput,
  ): Promise<Article> {
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

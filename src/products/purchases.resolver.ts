import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Article } from '../articles/entities/article.entity';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { RegisterProductPurchaseInput } from './dto/register-product-purchase.input';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';
import { PurchasesService } from './purchases.service';

@Resolver(() => ProductPurchase)
@UseGuards(GqlAuthGuard)
export class PurchasesResolver {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Query(() => [ProductPurchase], {
    description: 'Historial de compras (opcional por artículo)',
  })
  productPurchases(
    @CurrentUser() user: JwtPayload,
    @Args('articleId', { type: () => ID, nullable: true }) articleId?: string,
  ): Promise<ProductPurchase[]> {
    return this.purchasesService.findPurchases(user.sub, articleId);
  }

  @Query(() => [ConsumptionCycle], {
    description: 'Ciclos de consumo de un artículo',
  })
  consumptionCycles(
    @CurrentUser() user: JwtPayload,
    @Args('articleId', { type: () => ID }) articleId: string,
  ): Promise<ConsumptionCycle[]> {
    return this.purchasesService.findCycles(user.sub, articleId);
  }

  @Mutation(() => ProductPurchase, {
    description:
      'Registra una compra. Acepta un artículo existente (articleId) o crea uno nuevo (newArticle). Abre ciclo de consumo si no hay uno y marca la lista de compras.',
  })
  registerProductPurchase(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: RegisterProductPurchaseInput,
  ): Promise<ProductPurchase> {
    return this.purchasesService.registerPurchase(user.sub, input);
  }

  @Mutation(() => Article, {
    description:
      'Marca el artículo como agotado: cierra el ciclo de consumo y lo agrega a la lista de compras',
  })
  markProductDepleted(
    @CurrentUser() user: JwtPayload,
    @Args('articleId', { type: () => ID }) articleId: string,
    @Args('depletedOn', { nullable: true }) depletedOn?: string,
  ): Promise<Article> {
    return this.purchasesService.markDepleted(user.sub, articleId, depletedOn);
  }
}

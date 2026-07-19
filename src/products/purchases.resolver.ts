import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { RegisterProductPurchaseInput } from './dto/register-product-purchase.input';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';
import { Product } from './entities/product.entity';
import { PurchasesService } from './purchases.service';

@Resolver(() => ProductPurchase)
@UseGuards(GqlAuthGuard)
export class PurchasesResolver {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Query(() => [ProductPurchase], {
    description: 'Historial de compras de productos (opcional por producto)',
  })
  productPurchases(
    @CurrentUser() user: JwtPayload,
    @Args('productId', { type: () => ID, nullable: true }) productId?: string,
  ): Promise<ProductPurchase[]> {
    return this.purchasesService.findPurchases(user.sub, productId);
  }

  @Query(() => [ConsumptionCycle], {
    description: 'Ciclos de consumo de un producto',
  })
  consumptionCycles(
    @CurrentUser() user: JwtPayload,
    @Args('productId', { type: () => ID }) productId: string,
  ): Promise<ConsumptionCycle[]> {
    return this.purchasesService.findCycles(user.sub, productId);
  }

  @Mutation(() => ProductPurchase, {
    description:
      'Registra una compra. Acepta un producto existente (productId) o crea uno nuevo (newProduct). Abre ciclo de consumo si no hay uno y marca la lista de compras.',
  })
  registerProductPurchase(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: RegisterProductPurchaseInput,
  ): Promise<ProductPurchase> {
    return this.purchasesService.registerPurchase(user.sub, input);
  }

  @Mutation(() => Product, {
    description:
      'Marca el producto como agotado: cierra el ciclo de consumo y lo agrega a la lista de compras',
  })
  markProductDepleted(
    @CurrentUser() user: JwtPayload,
    @Args('productId', { type: () => ID }) productId: string,
    @Args('depletedOn', { nullable: true }) depletedOn?: string,
  ): Promise<Product> {
    return this.purchasesService.markDepleted(user.sub, productId, depletedOn);
  }
}

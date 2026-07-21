import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';
import { ProductStatsView } from './entities/product-stats.view';
import { Product } from './entities/product.entity';
import { ProductsResolver } from './products.resolver';
import { ProductsService } from './products.service';
import { PurchasesResolver } from './purchases.resolver';
import { PurchasesService } from './purchases.service';
import { ArticlesModule } from '../articles/articles.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductPurchase,
      ConsumptionCycle,
      ProductStatsView,
    ]),
    ShoppingListsModule,
    ArticlesModule,
  ],
  providers: [
    ProductsService,
    ProductsResolver,
    PurchasesService,
    PurchasesResolver,
  ],
  exports: [TypeOrmModule, ProductsService, PurchasesService],
})
export class ProductsModule {}

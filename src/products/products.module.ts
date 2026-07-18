import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';
import { ProductStatsView } from './entities/product-stats.view';
import { Product } from './entities/product.entity';
import { ProductsResolver } from './products.resolver';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductPurchase,
      ConsumptionCycle,
      ProductStatsView,
    ]),
  ],
  providers: [ProductsService, ProductsResolver],
  exports: [TypeOrmModule, ProductsService],
})
export class ProductsModule {}

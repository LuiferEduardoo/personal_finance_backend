import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { databaseConfig } from './config/database.config';
import { InstallmentsModule } from './installments/installments.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { ProductsModule } from './products/products.module';
import { ShoppingListsModule } from './shopping-lists/shopping-lists.module';
import { TagsModule } from './tags/tags.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: databaseConfig,
    }),
    UsersModule,
    AuthModule,
    CategoriesModule,
    PaymentMethodsModule,
    InstallmentsModule,
    TransactionsModule,
    TagsModule,
    ProductsModule,
    ShoppingListsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

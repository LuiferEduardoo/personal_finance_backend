import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticlesModule } from '../articles/articles.module';
import { ProductsModule } from '../products/products.module';
import { Expense } from './entities/expense.entity';
import { ExpenseItem } from './entities/expense-item.entity';
import { Income } from './entities/income.entity';
import { TransactionView } from './entities/transaction.view';
import { ExpensesResolver } from './expenses.resolver';
import { ExpensesService } from './expenses.service';
import { IncomesResolver } from './incomes.resolver';
import { IncomesService } from './incomes.service';
import { InflationResolver } from './inflation.resolver';
import { InflationService } from './inflation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, ExpenseItem, Income, TransactionView]),
    ArticlesModule,
    ProductsModule,
  ],
  providers: [
    ExpensesService,
    ExpensesResolver,
    IncomesService,
    IncomesResolver,
    InflationService,
    InflationResolver,
  ],
  exports: [TypeOrmModule, ExpensesService, IncomesService, InflationService],
})
export class TransactionsModule {}

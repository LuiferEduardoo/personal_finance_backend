import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticlesModule } from '../articles/articles.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { RecurringExpenseItem } from './entities/recurring-expense-item.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { RecurringExpensesCron } from './recurring-expenses.cron';
import { RecurringExpensesResolver } from './recurring-expenses.resolver';
import { RecurringExpensesService } from './recurring-expenses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringExpense, RecurringExpenseItem]),
    ArticlesModule,
    TransactionsModule,
  ],
  providers: [
    RecurringExpensesService,
    RecurringExpensesResolver,
    RecurringExpensesCron,
  ],
})
export class RecurringExpensesModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from './entities/expense.entity';
import { Income } from './entities/income.entity';
import { TransactionView } from './entities/transaction.view';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, Income, TransactionView])],
  exports: [TypeOrmModule],
})
export class TransactionsModule {}

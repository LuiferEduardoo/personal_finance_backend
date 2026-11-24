import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { LoanCharge } from './entities/loan-charge.entity';
import { LoanInstallment } from './entities/loan-installment.entity';
import { LoanPrepayment } from './entities/loan-prepayment.entity';
import { Loan } from './entities/loan.entity';
import { LoansResolver } from './loans.resolver';
import { LoansService } from './loans.service';

// Créditos personales: tabla de amortización, pagos y abonos a capital. Los
// pagos se registran como gastos (TransactionsModule) y el desembolso mueve
// el saldo de la cuenta (PaymentMethodsModule).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Loan,
      LoanCharge,
      LoanInstallment,
      LoanPrepayment,
    ]),
    CategoriesModule,
    PaymentMethodsModule,
    TransactionsModule,
  ],
  providers: [LoansService, LoansResolver],
})
export class LoansModule {}

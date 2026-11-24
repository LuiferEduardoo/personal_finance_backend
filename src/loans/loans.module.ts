import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { LoanCharge } from './entities/loan-charge.entity';
import { LoanInstallment } from './entities/loan-installment.entity';
import { LoanPrepayment } from './entities/loan-prepayment.entity';
import { Loan } from './entities/loan.entity';
import { LoanRemindersCron } from './loan-reminders.cron';
import { LoanRemindersService } from './loan-reminders.service';
import { LoansResolver } from './loans.resolver';
import { LoansService } from './loans.service';

// Créditos personales: tabla de amortización, pagos y abonos a capital. Los
// pagos se registran como gastos (TransactionsModule) y el desembolso mueve
// el saldo de la cuenta (PaymentMethodsModule). Un cron diario avisa en la
// app de las cuotas por vencer y vencidas (NotificationsModule).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Loan,
      LoanCharge,
      LoanInstallment,
      LoanPrepayment,
    ]),
    CategoriesModule,
    NotificationsModule,
    PaymentMethodsModule,
    TransactionsModule,
  ],
  providers: [
    LoansService,
    LoansResolver,
    LoanRemindersService,
    LoanRemindersCron,
  ],
})
export class LoansModule {}

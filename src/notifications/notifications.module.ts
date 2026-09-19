import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentMethod } from '../payment-methods/entities/payment-method.entity';
import { CardPaymentRemindersCron } from './card-payment-reminders.cron';
import { EmailService } from './email.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentMethod])],
  providers: [EmailService, CardPaymentRemindersCron],
  exports: [EmailService],
})
export class NotificationsModule {}

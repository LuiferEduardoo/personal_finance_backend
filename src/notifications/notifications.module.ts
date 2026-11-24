import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentMethod } from '../payment-methods/entities/payment-method.entity';
import { CardPaymentRemindersCron } from './card-payment-reminders.cron';
import { EmailService } from './email.service';
import { Notification } from './entities/notification.entity';
import { NotificationsCron } from './notifications.cron';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';

// Correo (Brevo) y notificaciones dentro de la app. Solo depende de
// TypeORM, así que cualquier módulo puede importarlo sin crear ciclos.
@Module({
  imports: [TypeOrmModule.forFeature([PaymentMethod, Notification])],
  providers: [
    EmailService,
    CardPaymentRemindersCron,
    NotificationsService,
    NotificationsResolver,
    NotificationsCron,
  ],
  exports: [EmailService, NotificationsService],
})
export class NotificationsModule {}

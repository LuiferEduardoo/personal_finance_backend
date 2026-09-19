import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentMethod,
  PaymentMethodType,
} from '../payment-methods/entities/payment-method.entity';
import { EmailService } from './email.service';

@Injectable()
export class CardPaymentRemindersCron {
  private readonly logger = new Logger(CardPaymentRemindersCron.name);
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly accounts: Repository<PaymentMethod>,
    private readonly email: EmailService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDay = tomorrow.getUTCDate();
    const lastDayOfMonth = new Date(
      Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const reminderOn = new Date().toISOString().slice(0, 10);
    const cards = await this.accounts.find({
      where: { type: PaymentMethodType.CREDIT, isActive: true },
      relations: { user: true },
    });
    for (const card of cards) {
      if (card.balance >= 0 || !card.user?.isActive) continue;
      if (!card.dueDay || Math.min(card.dueDay, lastDayOfMonth) !== tomorrowDay)
        continue;
      if (card.lastPaymentReminderOn === reminderOn) continue;
      try {
        const debt = Math.abs(card.balance).toLocaleString('es-CO', {
          style: 'currency',
          currency: card.currency,
        });
        await this.email.send(
          card.user.email,
          `Tu pago de ${card.name} vence mañana`,
          `<p>Hola ${card.user.firstName},</p><p>Tu tarjeta <strong>${card.name}</strong> tiene una deuda de <strong>${debt}</strong> y vence mañana.</p><p>Este aviso no realiza ningún pago.</p>`,
        );
        await this.accounts.update(card.id, {
          lastPaymentReminderOn: reminderOn,
        });
      } catch (error) {
        this.logger.error(
          `No se pudo avisar sobre la tarjeta ${card.id}`,
          error,
        );
      }
    }
  }
}

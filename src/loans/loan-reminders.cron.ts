import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  LOAN_REMINDERS_TIME_ZONE,
  LoanRemindersService,
} from './loan-reminders.service';

// avisos diarios de cuotas por vencer y vencidas
@Injectable()
export class LoanRemindersCron {
  private readonly logger = new Logger(LoanRemindersCron.name);

  constructor(private readonly reminders: LoanRemindersService) {}

  @Cron('0 8 * * *', { timeZone: LOAN_REMINDERS_TIME_ZONE })
  async run(): Promise<void> {
    try {
      await this.reminders.run();
    } catch (error) {
      this.logger.error('No se pudieron revisar las cuotas de créditos', error);
    }
  }
}

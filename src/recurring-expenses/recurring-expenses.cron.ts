import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringExpensesService } from './recurring-expenses.service';

// job diario que materializa los gastos recurrentes vencidos
@Injectable()
export class RecurringExpensesCron {
  private readonly logger = new Logger(RecurringExpensesCron.name);

  constructor(
    private readonly recurringExpensesService: RecurringExpensesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDaily(): Promise<void> {
    const generated = await this.recurringExpensesService.runDue();
    if (generated > 0) {
      this.logger.log(`Gastos recurrentes generados: ${generated}`);
    }
  }
}

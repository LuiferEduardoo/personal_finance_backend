import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BudgetAlertsService } from './budget-alerts.service';
import { BUDGET_TIME_ZONE } from './budget-period';

// Red de seguridad: los avisos se disparan al registrar cada gasto, pero si
// alguno se perdió (proceso caído, correo fallido) el cron lo recupera. El
// cerrojo por presupuesto y mes lo hace idempotente.
@Injectable()
export class BudgetAlertsCron {
  private readonly logger = new Logger(BudgetAlertsCron.name);

  constructor(private readonly alerts: BudgetAlertsService) {}

  @Cron('0 20 * * *', { timeZone: BUDGET_TIME_ZONE })
  async run(): Promise<void> {
    try {
      await this.alerts.checkAll();
    } catch (error) {
      this.logger.error('No se pudieron revisar los presupuestos', error);
    }
  }
}

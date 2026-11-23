import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { BudgetAlertsCron } from './budget-alerts.cron';
import { BudgetAlertsService } from './budget-alerts.service';
import { CategoryBudgetsResolver } from './category-budgets.resolver';
import { CategoryBudgetsService } from './category-budgets.service';
import { CategoryBudgetAlert } from './entities/category-budget-alert.entity';
import { CategoryBudget } from './entities/category-budget.entity';

// Presupuestos mensuales por categoría y sus avisos por correo. No importa
// TransactionsModule (el gasto del mes se calcula con SQL), así que
// TransactionsModule puede importarlo para disparar los avisos sin ciclo.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CategoryBudget,
      CategoryBudgetAlert,
      Category,
      User,
    ]),
    NotificationsModule,
  ],
  providers: [
    BudgetAlertsService,
    BudgetAlertsCron,
    CategoryBudgetsService,
    CategoryBudgetsResolver,
  ],
  exports: [BudgetAlertsService],
})
export class BudgetsModule {}

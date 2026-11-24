import { Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Recurrence } from '../common/enums/recurrence.enum';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpensesService } from '../transactions/expenses.service';
import { RecurringExpenseItem } from './entities/recurring-expense-item.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { RecurringExpensesService } from './recurring-expenses.service';

describe('RecurringExpensesService.runDue: notificaciones', () => {
  const template = (
    id: string,
    userId: string,
    nextRunOn: string,
  ): RecurringExpense =>
    ({
      id,
      userId,
      description: `Plantilla ${id}`,
      amount: 10000,
      currency: 'COP',
      exchangeRate: 1,
      recurrence: Recurrence.MONTHLY,
      nextRunOn,
      endOn: null,
      isActive: true,
      items: [],
      categoryId: null,
      paymentMethodId: null,
      merchant: null,
      notes: null,
    }) as unknown as RecurringExpense;

  function setup(due: RecurringExpense[]) {
    const recurringRepository = {
      find: jest.fn().mockResolvedValue(due),
      save: jest.fn((value: RecurringExpense) => Promise.resolve(value)),
    };
    const expensesService = { create: jest.fn().mockResolvedValue({}) };
    const notifications = { notifyMany: jest.fn().mockResolvedValue(1) };
    const service = new RecurringExpensesService(
      recurringRepository as unknown as Repository<RecurringExpense>,
      {} as Repository<RecurringExpenseItem>,
      {} as ArticlesService,
      expensesService as unknown as ExpensesService,
      notifications as unknown as NotificationsService,
    );
    return { service, notifications, expensesService };
  }

  it('la corrida del cron deja una notificación por usuario con lo generado', async () => {
    const ctx = setup([
      template('r-1', 'user-1', '2026-09-24'),
      template('r-2', 'user-1', '2026-11-24'),
      template('r-3', 'user-2', '2026-11-20'),
    ]);
    // r-1: 09-24 y 10-24 y 11-24 = 3; r-2: 1; r-3: 1
    await expect(ctx.service.runDue('2026-11-24')).resolves.toBe(5);

    expect(ctx.notifications.notifyMany).toHaveBeenCalledTimes(1);
    expect(ctx.notifications.notifyMany).toHaveBeenCalledWith([
      {
        userId: 'user-1',
        type: NotificationType.RECURRING_EXPENSES_GENERATED,
        title: 'Gastos recurrentes registrados',
        body: 'Se registraron 4 gastos recurrentes',
        link: '/movimientos',
        dedupeKey: 'recurring:user-1:2026-11-24',
      },
      expect.objectContaining({
        userId: 'user-2',
        body: 'Se registró 1 gasto recurrente',
        dedupeKey: 'recurring:user-2:2026-11-24',
      }),
    ]);
  });

  it('la mutation manual (con userId) no notifica: el usuario ya ve el resultado', async () => {
    const ctx = setup([template('r-1', 'user-1', '2026-11-24')]);
    await expect(ctx.service.runDue('2026-11-24', 'user-1')).resolves.toBe(1);
    expect(ctx.notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('sin gastos generados no inserta nada', async () => {
    const ctx = setup([]);
    await ctx.service.runDue('2026-11-24');
    expect(ctx.notifications.notifyMany).toHaveBeenCalledWith([]);
  });
});

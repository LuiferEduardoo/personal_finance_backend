import { Repository } from 'typeorm';
import { EmailService } from '../notifications/email.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetAlertsService } from './budget-alerts.service';
import { CategoryBudgetAlert } from './entities/category-budget-alert.entity';
import { CategoryBudget } from './entities/category-budget.entity';

describe('BudgetAlertsService', () => {
  const budget = {
    id: 'budget-1',
    userId: 'user-1',
    categoryId: 'cat-mercado',
    amount: 350000,
    currency: 'COP',
    user: { email: 'ana@example.com', firstName: 'Ana', isActive: true },
    category: { id: 'cat-mercado', name: 'Mercado' },
  } as unknown as CategoryBudget;

  function setup({
    spent,
    budgetIds = ['budget-1'],
    inserted = true,
    sendError,
  }: {
    spent: number;
    budgetIds?: string[];
    inserted?: boolean;
    sendError?: Error;
  }) {
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>((sql) =>
      Promise.resolve(
        sql.includes('ancestors')
          ? budgetIds.map((id) => ({ id }))
          : [{ budgetId: 'budget-1', spent: String(spent) }],
      ),
    );
    const budgetsRepository = {
      query,
      find: jest.fn().mockResolvedValue([budget]),
    };
    const builder = {
      insert: jest.fn(() => builder),
      into: jest.fn(() => builder),
      values: jest.fn(() => builder),
      orIgnore: jest.fn(() => builder),
      returning: jest.fn(() => builder),
      execute: jest
        .fn()
        .mockResolvedValue({ raw: inserted ? [{ id: 'alert-1' }] : [] }),
    };
    const alertsRepository = {
      createQueryBuilder: () => builder,
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const email = {
      send: sendError
        ? jest.fn().mockRejectedValue(sendError)
        : jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      notify: jest.fn().mockResolvedValue(true),
      removeByDedupeKeys: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BudgetAlertsService(
      budgetsRepository as unknown as Repository<CategoryBudget>,
      alertsRepository as unknown as Repository<CategoryBudgetAlert>,
      email as unknown as EmailService,
      notifications as unknown as NotificationsService,
    );
    return { service, query, builder, alertsRepository, email, notifications };
  }

  it('no avisa si el gasto del mes no supera el presupuesto', async () => {
    const ctx = setup({ spent: 350000 });
    await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
    expect(ctx.builder.insert).not.toHaveBeenCalled();
    expect(ctx.email.send).not.toHaveBeenCalled();
  });

  it('avisa una vez al superarlo, con categoría, presupuesto, gasto, exceso y mes', async () => {
    const ctx = setup({ spent: 400000 });
    await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');

    expect(ctx.builder.values).toHaveBeenCalledWith({
      budgetId: 'budget-1',
      period: '2026-11',
      spent: 400000,
    });
    expect(ctx.builder.orIgnore).toHaveBeenCalled();
    expect(ctx.email.send).toHaveBeenCalledTimes(1);
    const [to, subject, html] = ctx.email.send.mock.calls[0] as string[];
    expect(to).toBe('ana@example.com');
    expect(subject).toContain('Mercado');
    expect(html).toContain('Hola Ana');
    expect(html).toContain('noviembre de 2026');
    const money = (value: number) =>
      value.toLocaleString('es-CO', { style: 'currency', currency: 'COP' });
    expect(html).toContain(money(350000));
    expect(html).toContain(money(400000));
    expect(html).toContain(money(50000));
  });

  it('no repite el correo si el aviso del mes ya existía (insert ignorado)', async () => {
    const ctx = setup({ spent: 420000, inserted: false });
    await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-20');
    expect(ctx.builder.execute).toHaveBeenCalled();
    expect(ctx.email.send).not.toHaveBeenCalled();
  });

  it('un gasto de una subcategoría cuenta para el presupuesto del padre', async () => {
    const ctx = setup({ spent: 360000 });
    await ctx.service.checkExpense(
      'user-1',
      'cat-mercado-frutas',
      '2026-11-05',
    );

    // busca presupuestos en la categoría del gasto y en sus ancestros
    const [ancestorsSql, ancestorsParams] = ctx.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(ancestorsSql).toContain('WITH RECURSIVE ancestors');
    expect(ancestorsParams).toEqual(['cat-mercado-frutas', 'user-1']);
    // y el gasto del presupuesto suma su árbol de subcategorías, en moneda base
    const [spentSql, spentParams] = ctx.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(spentSql).toContain('c."parent_id" = t."category_id"');
    expect(spentSql).toContain('e."amount" * e."exchange_rate"');
    expect(spentParams).toEqual([['budget-1'], '2026-11']);
    expect(ctx.email.send).toHaveBeenCalledTimes(1);
  });

  it('no revisa nada si ningún presupuesto cubre la categoría', async () => {
    const ctx = setup({ spent: 999999, budgetIds: [] });
    await ctx.service.checkExpense('user-1', 'cat-ocio', '2026-11-05');
    expect(ctx.query).toHaveBeenCalledTimes(1);
    expect(ctx.email.send).not.toHaveBeenCalled();
  });

  it('si el correo falla no lanza y libera el aviso para reintentar', async () => {
    const ctx = setup({ spent: 400000, sendError: new Error('Brevo caído') });
    await expect(
      ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05'),
    ).resolves.toBeUndefined();
    expect(ctx.alertsRepository.delete).toHaveBeenCalledWith({
      id: 'alert-1',
    });
  });

  it('scheduleExpenseCheck no hace nada con gastos sin categoría', () => {
    const ctx = setup({ spent: 400000 });
    ctx.service.scheduleExpenseCheck('user-1', null, '2026-11-05');
    expect(ctx.query).not.toHaveBeenCalled();
  });

  it('resetAlert borra el aviso del mes y sus notificaciones', async () => {
    const ctx = setup({ spent: 0 });
    await ctx.service.resetAlert('budget-1', '2026-11');
    expect(ctx.alertsRepository.delete).toHaveBeenCalledWith({
      budgetId: 'budget-1',
      period: '2026-11',
    });
    expect(ctx.notifications.removeByDedupeKeys).toHaveBeenCalledWith([
      'budget-exceeded:budget-1:2026-11',
      'budget-near:budget-1:2026-11',
    ]);
  });

  describe('notificaciones en la app', () => {
    const money = (value: number) =>
      value.toLocaleString('es-CO', { style: 'currency', currency: 'COP' });

    it('al superarlo notifica BUDGET_EXCEEDED con categoría, gasto y tope', async () => {
      const ctx = setup({ spent: 400000 });
      await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
      expect(ctx.notifications.notify).toHaveBeenCalledTimes(1);
      const [userId, input] = ctx.notifications.notify.mock.calls[0] as [
        string,
        {
          type: NotificationType;
          body: string;
          link: string;
          dedupeKey: string;
        },
      ];
      expect(userId).toBe('user-1');
      expect(input.type).toBe(NotificationType.BUDGET_EXCEEDED);
      expect(input.dedupeKey).toBe('budget-exceeded:budget-1:2026-11');
      expect(input.link).toBe('/presupuestos');
      expect(input.body).toContain('Mercado');
      expect(input.body).toContain(money(400000));
      expect(input.body).toContain(money(350000));
    });

    it('notifica aunque el correo falle', async () => {
      const ctx = setup({ spent: 400000, sendError: new Error('Brevo caído') });
      await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
      expect(ctx.notifications.notify).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: NotificationType.BUDGET_EXCEEDED }),
      );
    });

    it('desde el 80 % notifica BUDGET_NEAR, solo en la app', async () => {
      const ctx = setup({ spent: 280000 });
      await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
      expect(ctx.notifications.notify).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          type: NotificationType.BUDGET_NEAR,
          dedupeKey: 'budget-near:budget-1:2026-11',
          link: '/presupuestos',
        }),
      );
      expect(ctx.builder.insert).not.toHaveBeenCalled();
      expect(ctx.email.send).not.toHaveBeenCalled();
    });

    it('justo en el tope sigue siendo "cerca", no excedido', async () => {
      const ctx = setup({ spent: 350000 });
      await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
      expect(ctx.notifications.notify).toHaveBeenCalledTimes(1);
      expect(ctx.notifications.notify).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: NotificationType.BUDGET_NEAR }),
      );
    });

    it('por debajo del 80 % no notifica', async () => {
      const ctx = setup({ spent: 279999 });
      await ctx.service.checkExpense('user-1', 'cat-mercado', '2026-11-05');
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });
  });
});

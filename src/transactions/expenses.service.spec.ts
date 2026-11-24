import { BadRequestException } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { BudgetAlertsService } from '../budgets/budget-alerts.service';
import { calculateInstallments } from '../installments/installment-calculator';
import { InstallmentPlan } from '../installments/entities/installment-plan.entity';
import { Installment } from '../installments/entities/installment.entity';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PurchasesService } from '../products/purchases.service';
import { ExpenseItem } from './entities/expense-item.entity';
import { Expense } from './entities/expense.entity';
import { ExpensesService } from './expenses.service';

describe('ExpensesService.updateCategoryIfUnchanged', () => {
  function setup(affected: number) {
    const builder = {
      update: jest.fn(() => builder),
      set: jest.fn(() => builder),
      where: jest.fn(() => builder),
      andWhere: jest.fn(() => builder),
      execute: jest.fn().mockResolvedValue({ affected }),
    };
    const expensesRepository = {
      createQueryBuilder: () => builder,
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'e1', occurredOn: '2026-11-05' }),
    };
    const accountsService = { adjustBalance: jest.fn() };
    const budgetAlerts = { scheduleExpenseCheck: jest.fn() };
    const service = new ExpensesService(
      expensesRepository as unknown as Repository<Expense>,
      {} as Repository<ExpenseItem>,
      {} as Repository<InstallmentPlan>,
      {} as Repository<Installment>,
      {} as ArticlesService,
      {} as PurchasesService,
      accountsService as unknown as PaymentMethodsService,
      {} as DataSource,
      budgetAlerts as unknown as BudgetAlertsService,
    );
    return { service, builder, accountsService, budgetAlerts };
  }

  it('actualiza solo si la categoría sigue siendo la esperada (también null)', async () => {
    const ctx = setup(1);
    await expect(
      ctx.service.updateCategoryIfUnchanged('user-1', 'e1', null, 'cat-1'),
    ).resolves.toBe(true);
    expect(ctx.builder.set).toHaveBeenCalledWith({ categoryId: 'cat-1' });
    expect(ctx.builder.where).toHaveBeenCalledWith('"id" = :id', { id: 'e1' });
    expect(ctx.builder.andWhere).toHaveBeenCalledWith('"user_id" = :userId', {
      userId: 'user-1',
    });
    expect(ctx.builder.andWhere).toHaveBeenCalledWith(
      '"category_id" IS NOT DISTINCT FROM CAST(:expected AS uuid)',
      { expected: null },
    );
    // la categoría no mueve saldos
    expect(ctx.accountsService.adjustBalance).not.toHaveBeenCalled();
    // pero sí puede exceder un presupuesto
    expect(ctx.budgetAlerts.scheduleExpenseCheck).toHaveBeenCalledWith(
      'user-1',
      'cat-1',
      '2026-11-05',
    );
  });

  it('devuelve false si el usuario la cambió entretanto', async () => {
    const ctx = setup(0);
    await expect(
      ctx.service.updateCategoryIfUnchanged('user-1', 'e1', 'cat-0', 'cat-1'),
    ).resolves.toBe(false);
    expect(ctx.budgetAlerts.scheduleExpenseCheck).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.update (compras a cuotas)', () => {
  const USER = 'user-1';

  function planFixture() {
    return {
      id: 'plan-1',
      userId: USER,
      paymentMethodId: 'acc-1',
      description: 'TV',
      totalAmount: 300,
      principalAmount: 300,
      installmentCount: 3,
      monthlyRate: 0,
      purchaseDate: '2026-11-10',
      firstDueDate: '2026-11-10',
    };
  }

  function planExpenses(): Partial<Expense>[] {
    return ['2026-11-10', '2026-12-10', '2027-01-10'].map((date, index) => ({
      id: `e${index + 1}`,
      userId: USER,
      planId: 'plan-1',
      installmentId: `i${index + 1}`,
      installment: { sequenceNumber: index + 1 } as Installment,
      paymentMethodId: 'acc-1',
      categoryId: 'cat-1',
      description: `TV (${index + 1}/3)`,
      amount: 100,
      currency: 'COP',
      exchangeRate: 1,
      occurredOn: date,
      merchant: 'Tienda',
      notes: null,
      receiptUrl: null,
    }));
  }

  function setup(expenses: Partial<Expense>[] = planExpenses()) {
    let created = 0;
    const manager = {
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((_entity: unknown, value: Record<string, unknown>) =>
        Promise.resolve({ ...value, id: `new-${++created}` }),
      ),
    };
    const expensesRepository = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(expenses.find((e) => e.id === where.id) ?? null),
      ),
      find: jest.fn().mockResolvedValue([...expenses].reverse()),
      create: jest.fn((value: object) => value),
    };
    const plansRepository = {
      findOne: jest.fn().mockResolvedValue(planFixture()),
    };
    const installmentsRepository = {
      create: jest.fn((value: object) => value),
    };
    const accountsService = {
      assertOwned: jest.fn().mockResolvedValue(undefined),
      assertCreditAvailable: jest.fn().mockResolvedValue(undefined),
      adjustBalance: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    const budgetAlerts = { scheduleExpenseCheck: jest.fn() };
    const service = new ExpensesService(
      expensesRepository as unknown as Repository<Expense>,
      {
        create: jest.fn((value: object) => value),
      } as unknown as Repository<ExpenseItem>,
      plansRepository as unknown as Repository<InstallmentPlan>,
      installmentsRepository as unknown as Repository<Installment>,
      {} as ArticlesService,
      {} as PurchasesService,
      accountsService as unknown as PaymentMethodsService,
      dataSource as unknown as DataSource,
      budgetAlerts as unknown as BudgetAlertsService,
    );
    return { service, manager, accountsService, dataSource, budgetAlerts };
  }

  const expenseUpdates = (manager: { update: jest.Mock }) =>
    manager.update.mock.calls.filter(([entity]) => entity === Expense);

  it('un cambio de campos se propaga a todas las cuotas sin mover saldos', async () => {
    const ctx = setup();
    await ctx.service.update(USER, {
      id: 'e2',
      description: 'Televisor',
      merchant: 'Otra tienda',
      categoryId: 'cat-2',
    });

    expect(ctx.accountsService.adjustBalance).not.toHaveBeenCalled();
    expect(ctx.accountsService.assertCreditAvailable).not.toHaveBeenCalled();
    const updates = expenseUpdates(ctx.manager);
    expect(updates.map(([, id]) => id)).toEqual(['e1', 'e2', 'e3']);
    updates.forEach(([, , fields], index) => {
      expect(fields).toMatchObject({
        description: `Televisor (${index + 1}/3)`,
        merchant: 'Otra tienda',
        categoryId: 'cat-2',
        amount: 100,
        paymentMethodId: 'acc-1',
      });
    });
    expect(ctx.manager.update).toHaveBeenCalledWith(
      InstallmentPlan,
      'plan-1',
      expect.objectContaining({ description: 'Televisor', totalAmount: 300 }),
    );
    expect(ctx.manager.save).not.toHaveBeenCalled();
    expect(ctx.manager.delete).not.toHaveBeenCalled();
    // meses viejos (cat-1) y nuevos (cat-2)
    expect(ctx.budgetAlerts.scheduleExpenseCheck).toHaveBeenCalledWith(
      USER,
      'cat-1',
      '2026-12-10',
    );
    expect(ctx.budgetAlerts.scheduleExpenseCheck).toHaveBeenCalledWith(
      USER,
      'cat-2',
      '2027-01-10',
    );
  });

  it('cambiar las cuotas y la tasa regenera la tabla y ajusta el saldo por la diferencia', async () => {
    const ctx = setup();
    const schedule = calculateInstallments(300, 6, 0.02, '2026-11-10');
    const newTotal =
      schedule.reduce((sum, part) => sum + Math.round(part.amount * 100), 0) /
      100;

    await ctx.service.update(USER, {
      id: 'e1',
      installmentCount: 6,
      monthlyInterestRate: 0.02,
    });

    expect(ctx.accountsService.adjustBalance).toHaveBeenNthCalledWith(
      1,
      'acc-1',
      300,
      ctx.manager,
    );
    expect(ctx.accountsService.assertCreditAvailable).toHaveBeenCalledWith(
      'acc-1',
      newTotal,
      ctx.manager,
    );
    expect(ctx.accountsService.adjustBalance).toHaveBeenNthCalledWith(
      2,
      'acc-1',
      -newTotal,
      ctx.manager,
    );
    expect(newTotal).toBeGreaterThan(300);
    // 3 cuotas actualizadas en sitio y 3 nuevas (cuota + gasto cada una)
    expect(expenseUpdates(ctx.manager)).toHaveLength(3);
    expect(expenseUpdates(ctx.manager)[2][2]).toMatchObject({
      description: 'TV (3/6)',
      amount: schedule[2].amount,
      occurredOn: '2027-01-10',
    });
    const savedExpenses = ctx.manager.save.mock.calls.filter(
      ([entity]) => entity === Expense,
    );
    expect(savedExpenses.map(([, value]) => value.description)).toEqual([
      'TV (4/6)',
      'TV (5/6)',
      'TV (6/6)',
    ]);
    expect(ctx.manager.update).toHaveBeenCalledWith(
      InstallmentPlan,
      'plan-1',
      expect.objectContaining({
        installmentCount: 6,
        monthlyRate: 0.02,
        totalAmount: newTotal,
        principalAmount: 300,
      }),
    );
  });

  it('redondea el capital a centavos igual que la tabla (1.005 -> 1.00)', async () => {
    const ctx = setup();
    await ctx.service.update(USER, { id: 'e1', amount: 1.005 });

    const amounts = expenseUpdates(ctx.manager).map(([, , f]) => f.amount);
    expect(amounts).toEqual([0.33, 0.33, 0.34]);
    expect(ctx.manager.update).toHaveBeenCalledWith(
      InstallmentPlan,
      'plan-1',
      expect.objectContaining({ principalAmount: 1, totalAmount: 1 }),
    );
    expect(ctx.accountsService.adjustBalance).toHaveBeenLastCalledWith(
      'acc-1',
      -1,
      ctx.manager,
    );
  });

  it('reducir las cuotas borra las sobrantes', async () => {
    const ctx = setup();
    await ctx.service.update(USER, { id: 'e3', installmentCount: 2 });

    expect(ctx.manager.delete).toHaveBeenCalledWith(Expense, {
      id: In(['e3']),
    });
    expect(ctx.manager.delete).toHaveBeenCalledWith(Installment, {
      id: In(['i3']),
    });
    expect(expenseUpdates(ctx.manager).map(([, , f]) => f.amount)).toEqual([
      150, 150,
    ]);
    // mismo total, misma cuenta: el saldo no se mueve
    expect(ctx.accountsService.adjustBalance).not.toHaveBeenCalled();
  });

  it('cambiar la cuenta mueve la deuda a la nueva', async () => {
    const ctx = setup();
    await ctx.service.update(USER, { id: 'e1', accountId: 'acc-2' });

    expect(ctx.accountsService.assertOwned).toHaveBeenCalledWith('acc-2', USER);
    expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
      'acc-1',
      300,
      ctx.manager,
    );
    expect(ctx.accountsService.assertCreditAvailable).toHaveBeenCalledWith(
      'acc-2',
      300,
      ctx.manager,
    );
    expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
      'acc-2',
      -300,
      ctx.manager,
    );
    expenseUpdates(ctx.manager).forEach(([, , fields]) =>
      expect(fields).toMatchObject({ paymentMethodId: 'acc-2' }),
    );
    expect(ctx.manager.update).toHaveBeenCalledWith(
      InstallmentPlan,
      'plan-1',
      expect.objectContaining({ paymentMethodId: 'acc-2' }),
    );
  });

  it('sin cupo en la cuenta nueva no escribe nada', async () => {
    const ctx = setup();
    ctx.accountsService.assertCreditAvailable.mockRejectedValue(
      new BadRequestException(
        'El gasto excede el cupo disponible de la tarjeta',
      ),
    );

    await expect(
      ctx.service.update(USER, { id: 'e1', amount: 900 }),
    ).rejects.toThrow('cupo disponible');
    expect(ctx.manager.update).not.toHaveBeenCalled();
    expect(ctx.manager.save).not.toHaveBeenCalled();
    expect(ctx.manager.delete).not.toHaveBeenCalled();
    expect(ctx.budgetAlerts.scheduleExpenseCheck).not.toHaveBeenCalled();
  });

  it.each([
    [{ installmentCount: 0 }],
    [{ installmentCount: 121 }],
    [{ installmentCount: 2.5 }],
    [{ monthlyInterestRate: -0.01 }],
  ])('rechaza una configuración de cuotas inválida %o', async (change) => {
    const ctx = setup();
    await expect(
      ctx.service.update(USER, { id: 'e1', ...change }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
  });

  describe('gasto sin plan', () => {
    const single = (): Partial<Expense>[] => [
      {
        id: 'x1',
        userId: USER,
        planId: null,
        paymentMethodId: 'acc-1',
        categoryId: 'cat-1',
        description: 'Café',
        amount: 10,
        occurredOn: '2026-11-10',
        items: [],
      },
    ];

    it('se edita como siempre', async () => {
      const ctx = setup(single());
      await ctx.service.update(USER, { id: 'x1', amount: 15 });

      expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
        'acc-1',
        10,
        ctx.manager,
      );
      expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
        'acc-1',
        -15,
        ctx.manager,
      );
      expect(ctx.manager.save).toHaveBeenCalledWith(
        Expense,
        expect.objectContaining({ id: 'x1', amount: 15 }),
      );
      expect(ctx.manager.update).not.toHaveBeenCalled();
    });

    it('create con manager usa esa transacción y no revisa presupuestos', async () => {
      const ctx = setup(single());
      const outer = {
        ...ctx.manager,
        getRepository: jest.fn(() => ({
          findOne: jest.fn().mockResolvedValue({ id: 'new-1' }),
        })),
      };

      const created = await ctx.service.create(
        USER,
        {
          description: 'Cuota crédito',
          amount: 100,
          accountId: 'acc-1',
          occurredOn: '2026-11-10',
        },
        outer as never,
      );

      expect(created).toEqual({ id: 'new-1' });
      expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
      expect(ctx.accountsService.assertCreditAvailable).toHaveBeenCalledWith(
        'acc-1',
        100,
        outer,
      );
      expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
        'acc-1',
        -100,
        outer,
      );
      expect(ctx.budgetAlerts.scheduleExpenseCheck).not.toHaveBeenCalled();
    });

    it.each(['update', 'remove'] as const)(
      'un pago de crédito no se puede %s desde Movimientos',
      async (action) => {
        const ctx = setup([{ ...single()[0], loanId: 'loan-1' }]);
        const run =
          action === 'update'
            ? ctx.service.update(USER, { id: 'x1', amount: 1 })
            : ctx.service.remove('x1', USER);
        await expect(run).rejects.toThrow('gestiónalo desde el crédito');
        expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
        expect(ctx.accountsService.adjustBalance).not.toHaveBeenCalled();
      },
    );

    it('sigue sin aceptar configuración de cuotas', async () => {
      const ctx = setup(single());
      await expect(
        ctx.service.update(USER, { id: 'x1', installmentCount: 3 }),
      ).rejects.toThrow('solo se puede indicar al crear');
    });
  });
});

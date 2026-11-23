import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import { BudgetAlertsService } from './budget-alerts.service';
import { currentPeriod } from './budget-period';
import { CategoryBudgetsService } from './category-budgets.service';
import { CategoryBudget } from './entities/category-budget.entity';

describe('CategoryBudgetsService', () => {
  const expenseCategory = {
    id: 'cat-mercado',
    userId: null,
    name: 'Mercado',
    kind: TransactionKind.EXPENSE,
  } as Category;

  function setup({
    category = expenseCategory as Category | null,
    existing = null as CategoryBudget | null,
  } = {}) {
    const budgetsRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((data: Partial<CategoryBudget>) => ({ ...data })),
      save: jest.fn((budget: CategoryBudget) =>
        Promise.resolve({ id: 'budget-1', ...budget }),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const categoriesRepository = {
      findOne: jest.fn().mockResolvedValue(category),
    };
    const alerts = {
      resetAlert: jest.fn().mockResolvedValue(undefined),
      checkBudget: jest.fn().mockResolvedValue(undefined),
      spentByBudget: jest
        .fn()
        .mockResolvedValue(new Map([['budget-1', 400000]])),
    };
    const service = new CategoryBudgetsService(
      budgetsRepository as unknown as Repository<CategoryBudget>,
      categoriesRepository as unknown as Repository<Category>,
      alerts as unknown as BudgetAlertsService,
    );
    return { service, budgetsRepository, categoriesRepository, alerts };
  }

  it('crea el presupuesto y devuelve el estado del mes', async () => {
    const ctx = setup();
    const status = await ctx.service.set('user-1', {
      categoryId: 'cat-mercado',
      amount: 350000,
    });
    expect(ctx.budgetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        categoryId: 'cat-mercado',
        amount: 350000,
        currency: 'COP',
      }),
    );
    expect(status).toMatchObject({
      id: 'budget-1',
      period: currentPeriod(),
      spent: 400000,
      remaining: -50000,
      percentage: 114.29,
      exceeded: true,
    });
    expect(ctx.alerts.resetAlert).not.toHaveBeenCalled();
    expect(ctx.alerts.checkBudget).toHaveBeenCalledWith('budget-1');
  });

  it('rechaza una categoría que no es de gasto', async () => {
    const ctx = setup({
      category: { ...expenseCategory, kind: TransactionKind.INCOME },
    });
    await expect(
      ctx.service.set('user-1', { categoryId: 'cat-mercado', amount: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.budgetsRepository.save).not.toHaveBeenCalled();
  });

  it('rechaza la categoría de otro usuario (no la encuentra)', async () => {
    const ctx = setup({ category: null });
    await expect(
      ctx.service.set('user-1', { categoryId: 'cat-ajena', amount: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // solo busca entre las globales y las propias
    expect(ctx.categoriesRepository.findOne).toHaveBeenCalledWith({
      where: [
        { id: 'cat-ajena', userId: expect.anything() as unknown },
        { id: 'cat-ajena', userId: 'user-1' },
      ],
    });
    expect(ctx.budgetsRepository.save).not.toHaveBeenCalled();
  });

  it('rechaza montos no positivos', async () => {
    const ctx = setup();
    await expect(
      ctx.service.set('user-1', { categoryId: 'cat-mercado', amount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('al subir el monto borra el aviso del mes en curso', async () => {
    const ctx = setup({
      existing: {
        id: 'budget-1',
        userId: 'user-1',
        categoryId: 'cat-mercado',
        amount: 350000,
        currency: 'COP',
      } as CategoryBudget,
    });
    await ctx.service.set('user-1', {
      categoryId: 'cat-mercado',
      amount: 500000,
    });
    expect(ctx.alerts.resetAlert).toHaveBeenCalledWith(
      'budget-1',
      currentPeriod(),
    );
  });

  it('al bajar el monto conserva el aviso del mes', async () => {
    const ctx = setup({
      existing: {
        id: 'budget-1',
        userId: 'user-1',
        categoryId: 'cat-mercado',
        amount: 350000,
        currency: 'COP',
      } as CategoryBudget,
    });
    await ctx.service.set('user-1', {
      categoryId: 'cat-mercado',
      amount: 300000,
    });
    expect(ctx.alerts.resetAlert).not.toHaveBeenCalled();
  });

  it('valida el formato del mes', async () => {
    const ctx = setup();
    await expect(ctx.service.findAll('user-1', '2026-13')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('remove falla si no hay presupuesto para la categoría', async () => {
    const ctx = setup();
    ctx.budgetsRepository.delete.mockResolvedValue({ affected: 0 });
    await expect(
      ctx.service.remove('user-1', 'cat-mercado'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

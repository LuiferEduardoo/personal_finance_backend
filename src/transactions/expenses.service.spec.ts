import { DataSource, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
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
    const expensesRepository = { createQueryBuilder: () => builder };
    const accountsService = { adjustBalance: jest.fn() };
    const service = new ExpensesService(
      expensesRepository as unknown as Repository<Expense>,
      {} as Repository<ExpenseItem>,
      {} as Repository<InstallmentPlan>,
      {} as Repository<Installment>,
      {} as ArticlesService,
      {} as PurchasesService,
      accountsService as unknown as PaymentMethodsService,
      {} as DataSource,
    );
    return { service, builder, accountsService };
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
  });

  it('devuelve false si el usuario la cambió entretanto', async () => {
    const ctx = setup(0);
    await expect(
      ctx.service.updateCategoryIfUnchanged('user-1', 'e1', 'cat-0', 'cat-1'),
    ).resolves.toBe(false);
  });
});

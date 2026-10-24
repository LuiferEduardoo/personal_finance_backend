import { ArticlesService } from '../articles/articles.service';
import { Expense } from '../transactions/entities/expense.entity';
import { CategorizationQueue } from './categorization-queue';
import {
  CategoryClassifierService,
  ClassificationResult,
  ClassifyInput,
} from './category-classifier.service';
import { ExpenseItemsCategorizationService } from './expense-items-categorization.service';

const item = (
  articleId: string,
  categoryId: string | null,
  extra: { unitPrice?: number; quantity?: number; discount?: number } = {},
) => ({
  articleId,
  article: { id: articleId, name: `Artículo ${articleId}`, categoryId },
  unitPrice: extra.unitPrice ?? 1000,
  quantity: extra.quantity ?? 1,
  discount: extra.discount ?? 0,
});

const expenseWith = (items: ReturnType<typeof item>[]) =>
  ({
    id: 'expense-1',
    merchant: 'Éxito',
    categoryId: 'cat-manual',
    items,
  }) as unknown as Expense;

function result(items: Record<string, string | null>): ClassificationResult {
  return {
    classified: true,
    items,
    invoiceCategoryId: 'cat-compra',
    expenseCategoryId: 'cat-compra',
    signals: { items: {}, invoice: null, defaultNoul: null },
  };
}

function setup(classification: ClassificationResult = result({})) {
  const classifier = { classify: jest.fn().mockResolvedValue(classification) };
  const articlesService = {
    assignCategoryIfMissing: jest.fn().mockResolvedValue(true),
  };
  const queue = new CategorizationQueue();
  const enqueue = jest.spyOn(queue, 'enqueue');
  const service = new ExpenseItemsCategorizationService(
    classifier as unknown as CategoryClassifierService,
    articlesService as unknown as ArticlesService,
    queue,
  );
  return { service, classifier, articlesService, queue, enqueue };
}

describe('ExpenseItemsCategorizationService', () => {
  it('clasifica solo los artículos sin categoría, con todos como contexto', async () => {
    const ctx = setup(result({ a2: 'cat-mercado', a3: null }));
    const expense = expenseWith([
      item('a1', 'cat-usuario'),
      item('a2', null, { unitPrice: 2500, quantity: 2, discount: 500 }),
      item('a3', null),
      // el mismo artículo en otra línea: una sola pregunta
      item('a2', null),
    ]);

    ctx.service.enqueueFor('user-1', expense);
    expect(ctx.enqueue).toHaveBeenCalledTimes(1);
    await ctx.queue.idle();

    const input = ctx.classifier.classify.mock.calls[0][0] as ClassifyInput;
    expect(input).toMatchObject({ userId: 'user-1', merchant: 'Éxito' });
    expect(input.defaultCategoryId).toBeUndefined();
    expect(input.items.map((i) => [i.key, i.classify])).toEqual([
      ['a1', false],
      ['a2', true],
      ['a3', true],
      ['a2', false],
    ]);
    expect(input.items[1]).toMatchObject({
      name: 'Artículo a2',
      quantity: 2,
      unitPrice: 2500,
      lineTotal: 4500,
    });
    expect(ctx.articlesService.assignCategoryIfMissing).toHaveBeenCalledTimes(
      1,
    );
    expect(ctx.articlesService.assignCategoryIfMissing).toHaveBeenCalledWith(
      'user-1',
      'a2',
      'cat-mercado',
    );
    // la categoría del gasto la eligió el usuario
    expect(expense.categoryId).toBe('cat-manual');
  });

  it('sin artículos por clasificar no encola nada ni llama a Jev', async () => {
    const ctx = setup();
    ctx.service.enqueueFor(
      'user-1',
      expenseWith([item('a1', 'cat-1'), item('a2', 'cat-2')]),
    );
    ctx.service.enqueueFor('user-1', expenseWith([]));
    await ctx.queue.idle();
    expect(ctx.enqueue).not.toHaveBeenCalled();
    expect(ctx.classifier.classify).not.toHaveBeenCalled();
  });

  it('ignora las líneas cuyo artículo ya no existe', async () => {
    const ctx = setup(result({ a1: 'cat-1' }));
    const orphan = { ...item('x', null), articleId: null, article: null };
    ctx.service.enqueueFor(
      'user-1',
      expenseWith([
        orphan as unknown as ReturnType<typeof item>,
        item('a1', null),
      ]),
    );
    await ctx.queue.idle();
    const input = ctx.classifier.classify.mock.calls[0][0] as ClassifyInput;
    expect(input.items.map((i) => i.key)).toEqual(['a1']);
  });

  it('un fallo al guardar un artículo no impide guardar los demás', async () => {
    const ctx = setup(result({ a1: 'cat-1', a2: 'cat-2' }));
    ctx.articlesService.assignCategoryIfMissing
      .mockRejectedValueOnce(new Error('db caída'))
      .mockResolvedValueOnce(true);
    ctx.service.enqueueFor(
      'user-1',
      expenseWith([item('a1', null), item('a2', null)]),
    );
    await ctx.queue.idle();
    expect(ctx.articlesService.assignCategoryIfMissing).toHaveBeenCalledTimes(
      2,
    );
  });
});

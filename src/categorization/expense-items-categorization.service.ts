import { Injectable, Logger } from '@nestjs/common';
import { ArticlesService } from '../articles/articles.service';
import { roundAmount } from '../common/discount';
import type { Expense } from '../transactions/entities/expense.entity';
import { CategorizationQueue } from './categorization-queue';
import { CategoryClassifierService } from './category-classifier.service';

// Clasificación de los artículos de un gasto registrado a mano. Solo se toca
// el artículo (y solo si sigue sin categoría): la categoría del gasto la eligió
// el usuario y no se cambia.
//
// Se dispara desde el resolver de createExpense y no desde
// ExpensesService.create, que también usan la ingesta de correo (que clasifica
// por su cuenta), los gastos recurrentes y la confirmación de borradores de
// factura (ya clasificados al analizarlos).
@Injectable()
export class ExpenseItemsCategorizationService {
  private readonly logger = new Logger(ExpenseItemsCategorizationService.name);

  constructor(
    private readonly classifier: CategoryClassifierService,
    private readonly articlesService: ArticlesService,
    private readonly queue: CategorizationQueue,
  ) {}

  /**
   * Encola la clasificación si algún artículo del gasto no tiene categoría.
   * Sin artículos por clasificar no se encola nada ni se llama a Jev. Vuelve
   * de inmediato: el gasto ya está guardado.
   */
  enqueueFor(userId: string, expense: Expense): void {
    const items = expense.items ?? [];
    if (!items.some((item) => item.article && !item.article.categoryId)) {
      return;
    }
    this.queue.enqueue(`gasto ${expense.id}`, () =>
      this.categorize(userId, expense),
    );
  }

  async categorize(userId: string, expense: Expense): Promise<void> {
    const asked = new Set<string>();
    const result = await this.classifier.classify({
      userId,
      merchant: expense.merchant,
      // todos los ítems dan contexto; solo se pregunta por los que no tienen
      // categoría, una vez por artículo
      items: (expense.items ?? []).flatMap((item) => {
        // una línea cuyo artículo se borró no aporta nada
        const article = item.article;
        if (!article) {
          return [];
        }
        const classify = !article.categoryId && !asked.has(article.id);
        asked.add(article.id);
        return [
          {
            key: article.id,
            name: article.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: roundAmount(
              item.unitPrice * item.quantity - item.discount,
            ),
            classify,
          },
        ];
      }),
    });

    for (const [articleId, categoryId] of Object.entries(result.items)) {
      if (!categoryId) {
        continue;
      }
      try {
        await this.articlesService.assignCategoryIfMissing(
          userId,
          articleId,
          categoryId,
        );
      } catch (error) {
        this.logger.warn(
          `No se pudo guardar la categoría sugerida del artículo ${articleId}: ${(error as Error).message}`,
        );
      }
    }
  }
}

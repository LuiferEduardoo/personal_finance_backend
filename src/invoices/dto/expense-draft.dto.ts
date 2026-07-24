import { ArticleType } from '../../articles/entities/article.entity';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';

// Borrador de artículo nuevo, con la forma de CreateArticleInput.
export interface DraftArticle {
  name: string;
  type: ArticleType;
  unit: UnitOfMeasure;
  brand: string | null;
}

// Línea del gasto, con la forma de ExpenseItemInput (siempre newArticle:
// GPT-4o no conoce los UUIDs del catálogo del usuario).
export interface ExpenseDraftItem {
  newArticle: DraftArticle;
  unitPrice: number;
  quantity: number;
  description: string | null;
}

// Borrador de gasto listo para que el frontend lo complete (accountId,
// categoryId) y lo envíe a la mutation createExpense. Refleja
// CreateExpenseInput salvo por los campos que requieren UUIDs del usuario.
export interface ExpenseDraft {
  description: string;
  merchant: string | null;
  occurredOn: string | null;
  currency: string;
  // Solo se rellena cuando NO hay ítems; con ítems el server recalcula el
  // importe como la suma de los subtotales.
  amount: number | null;
  // Categoría sugerida como texto (no UUID); el usuario elige la real.
  categorySuggestion: string | null;
  // Lo asigna el usuario después.
  accountId: null;
  items: ExpenseDraftItem[];
}

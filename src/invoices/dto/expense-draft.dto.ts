import { ArticleType } from '../../articles/entities/article.entity';
import { UnitOfMeasure } from '../../common/enums/unit-of-measure.enum';

// Borrador de artículo nuevo, con la forma de CreateArticleInput.
export interface DraftArticle {
  name: string;
  type: ArticleType;
  unit: UnitOfMeasure;
  brand: string | null;
  // Categoría sugerida por el clasificador (UUID de una categoría de gasto
  // del usuario), o null. Solo se aplica si el artículo se crea nuevo: si ya
  // existe en el catálogo se conserva su categoría.
  categoryId: string | null;
}

// Línea del gasto, con la forma de ExpenseItemInput (siempre newArticle:
// GPT-4o no conoce los UUIDs del catálogo del usuario).
export interface ExpenseDraftItem {
  newArticle: DraftArticle;
  // Precio por unidad (por kg en productos pesados). Si la factura solo trae
  // el total de la línea se deriva como (lineTotal + discount) / quantity.
  // null si no hay forma de saberlo: el usuario debe completarlo (ver
  // `warnings`).
  unitPrice: number | null;
  quantity: number;
  // Descuento en importe sobre la línea, o null. Lo acepta ExpenseItemInput.
  discount: number | null;
  // Total impreso de la línea (unitPrice * quantity - discount), o null.
  // Solo sirve para cuadrar: ExpenseItemInput no lo usa.
  lineTotal: number | null;
  description: string | null;
}

// Borrador de gasto listo para que el frontend lo complete (accountId) y lo
// envíe a POST /invoices/expense. Refleja CreateExpenseInput salvo por los
// campos que requieren UUIDs del usuario o solo sirven para revisar.
export interface ExpenseDraft {
  description: string;
  merchant: string | null;
  occurredOn: string | null;
  currency: string;
  // Solo se rellena cuando NO hay ítems; con ítems el server recalcula el
  // importe como la suma de los subtotales.
  amount: number | null;
  // Total impreso de la factura, para cuadrar contra la suma de las líneas.
  total: number | null;
  // Categoría sugerida por el clasificador (UUID), o null si no hay una
  // decisión clara. El usuario puede cambiarla antes de confirmar.
  categoryId: string | null;
  // @deprecated Usa `categoryId`. Texto libre que propone GPT-4o; se
  // mantiene por compatibilidad con clientes antiguos.
  categorySuggestion: string | null;
  // Lo asigna el usuario después.
  accountId: null;
  items: ExpenseDraftItem[];
  // Avisos legibles (en español) cuando una línea o la factura no cuadra, o
  // cuando se derivó un precio. Los números NO se corrigen: el usuario revisa.
  warnings: string[];
}

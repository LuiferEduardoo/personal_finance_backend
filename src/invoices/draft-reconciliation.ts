import { roundAmount } from '../common/discount';
import { ExpenseDraftItem } from './dto/expense-draft.dto';

// Holgura para cuadrar importes: absorbe redondeos (productos pesados,
// impuestos repartidos por línea) sin tapar errores de lectura reales.
// Se toma la mayor entre una cantidad fija y un porcentaje del importe.
const ABSOLUTE_TOLERANCE = 1;
const RELATIVE_TOLERANCE = 0.005;

// Línea tal como la devuelve el modelo: el precio unitario puede faltar.
export type ExtractedItem = Omit<ExpenseDraftItem, 'newArticle'> & {
  newArticle: Omit<ExpenseDraftItem['newArticle'], 'categoryId'>;
};

export interface ReconciledItems {
  items: ExpenseDraftItem[];
  warnings: string[];
}

function tolerance(reference: number): number {
  return Math.max(ABSOLUTE_TOLERANCE, Math.abs(reference) * RELATIVE_TOLERANCE);
}

// true si dos importes cuadran dentro de la holgura de redondeo
export function amountsMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= tolerance(expected);
}

function format(value: number): string {
  return roundAmount(value).toLocaleString('es-CO');
}

// subtotal de la línea con la misma fórmula que usa el server al crear el gasto
export function lineSubtotal(item: {
  unitPrice: number | null;
  quantity: number;
  discount: number | null;
}): number | null {
  if (item.unitPrice == null) {
    return null;
  }
  return roundAmount(item.unitPrice * item.quantity - (item.discount ?? 0));
}

/**
 * Cuadra cada línea (unitPrice * quantity - discount ≈ lineTotal) y la
 * factura completa (suma de líneas ≈ total). Lo que no cuadra se avisa en
 * `warnings`; los números NO se corrigen, salvo derivar el precio unitario
 * cuando falta y la línea trae su total.
 */
export function reconcileItems(
  extracted: ExtractedItem[],
  total: number | null,
): ReconciledItems {
  const warnings: string[] = [];

  const items = extracted.map((raw, index): ExpenseDraftItem => {
    const label = `Línea ${index + 1} ("${raw.newArticle.name}")`;
    const quantity = raw.quantity > 0 ? raw.quantity : 1;
    const discount = raw.discount && raw.discount > 0 ? raw.discount : null;
    let unitPrice = raw.unitPrice;

    if (raw.quantity <= 0) {
      warnings.push(
        `${label}: la cantidad leída (${raw.quantity}) no es válida; se usa 1.`,
      );
    }

    if (unitPrice == null && raw.lineTotal != null) {
      unitPrice = roundAmount((raw.lineTotal + (discount ?? 0)) / quantity);
      warnings.push(
        `${label}: la factura no muestra el precio unitario; se calculó como total de la línea / cantidad (${format(unitPrice)}).`,
      );
    } else if (unitPrice == null) {
      warnings.push(
        `${label}: no se pudo leer el precio unitario ni el total de la línea; complétalo antes de guardar.`,
      );
    } else if (raw.lineTotal != null) {
      const subtotal = lineSubtotal({ unitPrice, quantity, discount })!;
      if (!amountsMatch(subtotal, raw.lineTotal)) {
        warnings.push(
          `${label}: ${format(unitPrice)} × ${quantity}${discount ? ` − ${format(discount)}` : ''} = ${format(subtotal)}, pero la factura muestra ${format(raw.lineTotal)}. Revisa el precio, la cantidad o el descuento.`,
        );
      }
    }

    return {
      ...raw,
      newArticle: { ...raw.newArticle, categoryId: null },
      unitPrice,
      quantity,
      discount,
    };
  });

  if (total != null && items.length > 0) {
    const subtotals = items.map(lineSubtotal);
    if (subtotals.every((subtotal) => subtotal != null)) {
      const sum = roundAmount(subtotals.reduce((acc, value) => acc + value, 0));
      if (!amountsMatch(sum, total)) {
        warnings.push(
          `La suma de las líneas (${format(sum)}) no coincide con el total de la factura (${format(total)}); diferencia de ${format(sum - total)}. Puede faltar una línea, un descuento global o un cargo. El gasto se registrará por la suma de las líneas.`,
        );
      }
    }
  }

  return { items, warnings };
}

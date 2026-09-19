import { round } from './money';
import { Annualized, annualize, daysBetween, PERCENT_DP } from './returns';

// TWR (Time-Weighted Return): rentabilidad encadenada que NEUTRALIZA el efecto
// de cuándo entró o salió el dinero. Es la que mide cómo lo hicieron las
// inversiones, no cómo lo hizo el momento de los aportes; para eso está el XIRR.
//
// Módulo puro: cero Nest, cero E/S.

export const TWR_BASE_INDEX = 100;
export const INDEX_DP = 12;

export interface DayPoint {
  /** Fecha del cierre (YYYY-MM-DD) */
  date: string;
  /** Valor total de la cartera al cierre, en moneda base (posiciones + efectivo) */
  endValue: number;
  /**
   * Flujo EXTERNO neto del día en moneda base: depósitos y transferencias de
   * entrada positivos, retiros y salidas negativos. Dividendos, intereses,
   * comisiones e impuestos NO son flujos externos: son internos y el TWR debe
   * verlos como variación de valor.
   */
  externalFlow: number;
}

export interface TwrDay {
  date: string;
  /** Factor del día: V_d / (V_{d-1} + F_d) */
  factor: number;
  /** Índice encadenado, base 100 al inicio de la serie */
  index: number;
  /** true cuando el denominador no era positivo y el factor se forzó a 1 */
  degenerate: boolean;
}

export interface TwrResult {
  days: TwrDay[];
  /** Rentabilidad acumulada de toda la serie, en % */
  totalReturn: number | null;
  annualized: Annualized;
}

// Convenio de flujo a PRINCIPIO de día: el aporte del día ya está disponible
// para invertirse ese mismo día.
//
//   r_d = V_d / (V_{d-1} + F_d)
//
// Esto resuelve el arranque sin caso especial: con V_0 = 0 y F_1 = depósito,
// el primer factor es V_1 / F_1.
export function chainLink(points: DayPoint[]): TwrResult {
  const days: TwrDay[] = [];
  let previousValue = 0;
  let index = TWR_BASE_INDEX;

  for (const point of points) {
    const denominator = previousValue + point.externalFlow;
    let factor = 1;
    let degenerate = false;

    if (denominator > 0) {
      factor = point.endValue / denominator;
      if (!Number.isFinite(factor) || factor < 0) {
        factor = 1;
        degenerate = true;
      }
    } else {
      // cartera vacía, o vaciada y vuelta a financiar: no hay capital sobre el
      // que medir rentabilidad ese día. Se marca y la cadena continúa sin
      // dividir por cero ni por un número negativo.
      degenerate = true;
    }

    index = round(index * factor, INDEX_DP);
    days.push({
      date: point.date,
      factor: round(factor, INDEX_DP),
      index,
      degenerate,
    });
    previousValue = point.endValue;
  }

  if (days.length === 0) {
    return {
      days,
      totalReturn: null,
      annualized: annualize(0, 0),
    };
  }

  const growth = days[days.length - 1].index / TWR_BASE_INDEX;
  const span = daysBetween(points[0].date, points[points.length - 1].date);

  return {
    days,
    totalReturn: round((growth - 1) * 100, PERCENT_DP),
    annualized: annualize(growth, span),
  };
}

// Rentabilidad entre dos puntos cualesquiera de una serie ya encadenada: dos
// lecturas y una división. Es la razón de persistir twr_index por día.
export function returnBetween(
  fromIndex: number,
  toIndex: number,
): number | null {
  if (fromIndex <= 0) {
    return null;
  }
  return round((toIndex / fromIndex - 1) * 100, PERCENT_DP);
}

export function annualizedBetween(
  fromIndex: number,
  toIndex: number,
  fromDate: string,
  toDate: string,
): Annualized {
  if (fromIndex <= 0) {
    return annualize(0, 0);
  }
  return annualize(toIndex / fromIndex, daysBetween(fromDate, toDate));
}

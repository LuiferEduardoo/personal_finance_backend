import { AnnualizedStatus } from '../../common/enums/return-status.enum';
import { round, roundMoney, safeDivide } from './money';

// Rentabilidades derivadas. Lo iterativo y lo que decide "devolver null
// cuando no hay base" vive aquí, no en SQL.

export const PERCENT_DP = 4;

// rentabilidad simple: (valor final - aportado) / aportado
export function simpleReturn(
  currentValue: number,
  investedCapital: number,
): number | null {
  if (investedCapital <= 0) {
    return null;
  }
  return round(
    safeDivide(currentValue - investedCapital, investedCapital) * 100,
    PERCENT_DP,
  );
}

// variación porcentual entre dos valores; null si no hay base con la que comparar
export function percentChange(from: number, to: number): number | null {
  if (from <= 0) {
    return null;
  }
  return round(safeDivide(to - from, from) * 100, PERCENT_DP);
}

export { AnnualizedStatus };

export interface Annualized {
  rate: number | null;
  status: AnnualizedStatus;
}

// Anualiza un factor de crecimiento. Se SUPRIME por debajo de 365 días a
// propósito: anualizar un retorno de dos meses es la forma más fácil de
// publicar un número sin sentido.
export function annualize(growthFactor: number, days: number): Annualized {
  if (growthFactor <= 0 || !Number.isFinite(growthFactor)) {
    return { rate: null, status: AnnualizedStatus.NO_BASE };
  }
  if (days < 365) {
    return { rate: null, status: AnnualizedStatus.PERIOD_TOO_SHORT };
  }
  const rate = (growthFactor ** (365 / days) - 1) * 100;
  return { rate: round(rate, PERCENT_DP), status: AnnualizedStatus.OK };
}

// CAGR clásico a partir de valor inicial y final
export function cagr(
  startValue: number,
  endValue: number,
  days: number,
): Annualized {
  if (startValue <= 0) {
    return { rate: null, status: AnnualizedStatus.NO_BASE };
  }
  return annualize(endValue / startValue, days);
}

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

// suma de importes en moneda base, redondeando en cada acumulación
export function sumBase(values: number[]): number {
  return values.reduce((total, value) => roundMoney(total + value), 0);
}

// Aritmética de dinero y cantidades para la cartera.
//
// A propósito NO se usa decimal.js: todo valor persistido pasa por `numeric` y
// se redondea a 6 decimales al escribir, y float64 carga 15-16 dígitos
// significativos, así que el error relativo se queda cerca de 1e-9 en carteras
// de hasta 1e9. Si algún día hace falta precisión de declaración fiscal, se
// cambia la implementación DETRÁS de este módulo: esa indirección es la razón
// entera de que este archivo exista.

// decimales de las columnas numeric correspondientes
export const MONEY_DP = 6;
export const QUANTITY_DP = 10;
export const PRICE_DP = 10;
export const RATE_DP = 10;

export function round(value: number, dp: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** dp;
  // el +Number.EPSILON evita que 1.005 caiga a 1.00 por la representación binaria
  return (
    Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor
  );
}

export const roundMoney = (value: number): number => round(value, MONEY_DP);
export const roundQuantity = (value: number): number =>
  round(value, QUANTITY_DP);
export const roundPrice = (value: number): number => round(value, PRICE_DP);

// suma redondeando en cada acumulación, para que un millón de sumas no
// arrastre el error
export function addMoney(a: number, b: number): number {
  return roundMoney(a + b);
}

export function addQuantity(a: number, b: number): number {
  return roundQuantity(a + b);
}

// convierte a la moneda base del usuario con la tasa congelada en la operación
export function toBase(amount: number, fxRate: number): number {
  return roundMoney(amount * fxRate);
}

// divisiones que no deben explotar: una cantidad 0 en una operación mal
// importada devuelve 0 en vez de Infinity o NaN
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) {
    return 0;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

// comparación con tolerancia: dos cantidades que difieren por debajo de la
// precisión de la columna son la misma cantidad
const QUANTITY_EPSILON = 1e-10;

export function isZeroQuantity(value: number): boolean {
  return Math.abs(value) < QUANTITY_EPSILON;
}

export function isNegativeQuantity(value: number): boolean {
  return value < -QUANTITY_EPSILON;
}

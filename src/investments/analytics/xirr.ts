import { XirrStatus } from '../../common/enums/return-status.enum';
import { round } from './money';

// XIRR / MWR: tasa interna de retorno sobre una serie de flujos irregulares.
// Es la rentabilidad que SÍ depende de cuándo metiste el dinero, al revés que
// el TWR. Módulo puro: cero Nest, cero E/S.

export interface CashFlow {
  /** Fecha del flujo (YYYY-MM-DD) */
  date: string;
  /**
   * Desde la perspectiva del inversor: el dinero que ENTRA a la cartera es
   * negativo y el que SALE es positivo. El valor de mercado final entra como
   * un flujo positivo en la fecha de corte.
   */
  amount: number;
}

export { XirrStatus };

export interface XirrResult {
  /** Tasa anualizada en %, o null si no se pudo calcular */
  rate: number | null;
  status: XirrStatus;
}

const DAYS_PER_YEAR = 365;
const MAX_NEWTON_ITERATIONS = 60;
const MAX_BISECTION_ITERATIONS = 200;
const MAX_STEP = 1;
const MIN_RATE = -0.999999;
const BRACKET_LOW = -0.9999;
const BRACKET_HIGH = 10;

interface Normalized {
  years: number[];
  amounts: number[];
  scale: number;
}

export function xirr(flows: CashFlow[]): XirrResult {
  const normalized = normalize(flows);
  if (!normalized) {
    return { rate: null, status: XirrStatus.NOT_ENOUGH_FLOWS };
  }
  // sin cambio de signo la ecuación no tiene raíz: es el caso de "solo he
  // aportado y todavía no hay valor"
  const hasPositive = normalized.amounts.some((amount) => amount > 0);
  const hasNegative = normalized.amounts.some((amount) => amount < 0);
  if (!hasPositive || !hasNegative) {
    return { rate: null, status: XirrStatus.NO_SIGN_CHANGE };
  }

  const solved = newtonRaphson(normalized) ?? bisect(normalized);
  if (solved === null) {
    return { rate: null, status: XirrStatus.DID_NOT_CONVERGE };
  }
  return { rate: round(solved * 100, 4), status: XirrStatus.OK };
}

function normalize(flows: CashFlow[]): Normalized | null {
  const usable = flows.filter(
    (flow) => Number.isFinite(flow.amount) && flow.amount !== 0,
  );
  if (usable.length < 2) {
    return null;
  }
  const sorted = [...usable].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const start = Date.parse(`${sorted[0].date}T00:00:00Z`);
  const last = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(last) || last === start) {
    // todos el mismo día: no hay periodo sobre el que anualizar
    return null;
  }
  return {
    years: sorted.map(
      (flow) =>
        (Date.parse(`${flow.date}T00:00:00Z`) - start) /
        86_400_000 /
        DAYS_PER_YEAR,
    ),
    amounts: sorted.map((flow) => flow.amount),
    // la tolerancia se mide RELATIVA al mayor flujo: una tolerancia absoluta
    // falla en silencio en carteras grandes
    scale: Math.max(...sorted.map((flow) => Math.abs(flow.amount))),
  };
}

function npv({ years, amounts }: Normalized, rate: number): number {
  const base = 1 + rate;
  let total = 0;
  for (let i = 0; i < amounts.length; i += 1) {
    total += amounts[i] / base ** years[i];
  }
  return total;
}

function npvDerivative({ years, amounts }: Normalized, rate: number): number {
  const base = 1 + rate;
  let total = 0;
  for (let i = 0; i < amounts.length; i += 1) {
    total += (-years[i] * amounts[i]) / base ** (years[i] + 1);
  }
  return total;
}

function newtonRaphson(input: Normalized): number | null {
  const tolerance = 1e-7 * input.scale;
  let rate = 0.1;

  for (let i = 0; i < MAX_NEWTON_ITERATIONS; i += 1) {
    const value = npv(input, rate);
    if (!Number.isFinite(value)) {
      return null;
    }
    if (Math.abs(value) < tolerance) {
      return rate;
    }
    const slope = npvDerivative(input, rate);
    if (!Number.isFinite(slope) || slope === 0) {
      return null;
    }
    // el paso se limita para que una derivada casi plana no dispare la tasa
    // fuera del dominio en una sola iteración
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, value / slope));
    const next = rate - step;
    if (next <= MIN_RATE) {
      return null;
    }
    if (Math.abs(next - rate) < 1e-12) {
      return Math.abs(npv(input, next)) < tolerance ? next : null;
    }
    rate = next;
  }
  return null;
}

// Respaldo cuando Newton no converge: se busca un cambio de signo barriendo el
// dominio y luego se bisecciona. Más lento, pero no depende de la derivada.
function bisect(input: Normalized): number | null {
  const tolerance = 1e-7 * input.scale;
  let low = BRACKET_LOW;
  let lowValue = npv(input, low);
  let high: number | null = null;
  let highValue = 0;

  const steps = 200;
  for (let i = 1; i <= steps; i += 1) {
    const candidate = BRACKET_LOW + ((BRACKET_HIGH - BRACKET_LOW) * i) / steps;
    const value = npv(input, candidate);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (Math.sign(value) !== Math.sign(lowValue)) {
      high = candidate;
      highValue = value;
      break;
    }
    low = candidate;
    lowValue = value;
  }

  if (high === null) {
    return null;
  }

  for (let i = 0; i < MAX_BISECTION_ITERATIONS; i += 1) {
    const middle = (low + high) / 2;
    const value = npv(input, middle);
    if (Math.abs(value) < tolerance || high - low < 1e-12) {
      return middle;
    }
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = middle;
      lowValue = value;
    } else {
      high = middle;
      highValue = value;
    }
  }
  void highValue;
  return (low + high) / 2;
}

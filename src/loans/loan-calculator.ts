import { addMonths } from '../installments/installment-calculator';

// mismo modo que LoanChargeMode (se repite aquí para que el cálculo sea puro y
// no dependa de las entidades)
export type LoanChargeCalculationMode = 'fixed' | 'percent_of_balance';

export interface LoanChargeSpec {
  mode: LoanChargeCalculationMode;
  // FIXED: dinero por cuota; PERCENT_OF_BALANCE: fracción mensual sobre el
  // saldo de capital al inicio del periodo
  value: number;
}

export interface LoanInstallmentBreakdown {
  sequenceNumber: number;
  dueDate: string;
  openingBalance: number;
  principalAmount: number;
  interestAmount: number;
  chargesAmount: number;
  amount: number;
}

export interface LoanScheduleInput {
  principal: number;
  monthlyRate: number;
  // fecha de vencimiento de la cuota 1 del crédito: la de la cuota n es
  // firstDueDate + (n - 1) meses, aunque la tabla empiece más adelante
  firstDueDate: string;
  charges?: LoanChargeSpec[];
  // número de la primera cuota de la tabla (al regenerar tras un abono)
  startSequence?: number;
}

// decimales con los que se guarda la tasa (numeric(12,10)); el cálculo usa la
// tasa ya redondeada para que regenerar la tabla dé lo mismo
export const RATE_DECIMALS = 10;
// tope de cuotas de un crédito (50 años)
export const MAX_LOAN_INSTALLMENTS = 600;

const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (amount: number): number => amount / 100;

export const roundRate = (rate: number): number =>
  Number(rate.toFixed(RATE_DECIMALS));

/** Tasa efectiva anual → tasa mensual equivalente: (1 + EA)^(1/12) − 1. */
export function effectiveAnnualToMonthly(effectiveAnnualRate: number): number {
  return roundRate((1 + effectiveAnnualRate) ** (1 / 12) - 1);
}

/**
 * Cuota fija (capital + interés) del sistema francés, en centavos.
 */
export function frenchPaymentCents(
  principalCents: number,
  installmentCount: number,
  monthlyRate: number,
): number {
  const raw =
    monthlyRate === 0
      ? principalCents / installmentCount
      : (principalCents * monthlyRate * (1 + monthlyRate) ** installmentCount) /
        ((1 + monthlyRate) ** installmentCount - 1);
  return Math.round(raw);
}

function chargesCents(
  openingCents: number,
  charges: LoanChargeSpec[] | undefined,
): number {
  return (charges ?? []).reduce(
    (sum, charge) =>
      sum +
      (charge.mode === 'fixed'
        ? toCents(charge.value)
        : Math.round(openingCents * charge.value)),
    0,
  );
}

// arma la tabla con una cuota fija (capital + interés) dada; la última
// absorbe el residuo del capital
function buildSchedule(
  input: LoanScheduleInput,
  principalCents: number,
  paymentCents: number,
  installmentCount: number,
): LoanInstallmentBreakdown[] {
  const startSequence = input.startSequence ?? 1;
  let remainingCents = principalCents;

  return Array.from({ length: installmentCount }, (_, index) => {
    const openingCents = remainingCents;
    const interestCents = Math.round(openingCents * input.monthlyRate);
    const principalForPeriod =
      index === installmentCount - 1
        ? openingCents
        : Math.max(0, Math.min(openingCents, paymentCents - interestCents));
    const otherCents = chargesCents(openingCents, input.charges);
    remainingCents -= principalForPeriod;
    const sequenceNumber = startSequence + index;

    return {
      sequenceNumber,
      dueDate: addMonths(input.firstDueDate, sequenceNumber - 1),
      openingBalance: fromCents(openingCents),
      principalAmount: fromCents(principalForPeriod),
      interestAmount: fromCents(interestCents),
      chargesAmount: fromCents(otherCents),
      amount: fromCents(principalForPeriod + interestCents + otherCents),
    };
  });
}

/**
 * Tabla de amortización de un crédito (sistema francés): cuota fija de
 * capital + interés y, encima, los cargos de cada periodo (seguros y
 * comisiones). Todo en centavos; la última cuota absorbe el residuo del
 * capital, así que la suma de los capitales es exactamente el capital.
 */
export function calculateLoanSchedule(
  input: LoanScheduleInput & { installmentCount: number },
): LoanInstallmentBreakdown[] {
  const principalCents = toCents(input.principal);
  const paymentCents = frenchPaymentCents(
    principalCents,
    input.installmentCount,
    input.monthlyRate,
  );
  return buildSchedule(
    input,
    principalCents,
    paymentCents,
    input.installmentCount,
  );
}

/**
 * Tabla que conserva una cuota fija (capital + interés) dada y acorta el
 * plazo: tantas cuotas como hagan falta para saldar el capital, con la última
 * más pequeña. Es la tabla de un abono a capital "reduciendo plazo".
 */
export function calculateLoanScheduleWithPayment(
  input: LoanScheduleInput & { payment: number },
): LoanInstallmentBreakdown[] {
  const principalCents = toCents(input.principal);
  const paymentCents = toCents(input.payment);
  let remainingCents = principalCents;
  let count = 0;
  while (remainingCents > 0) {
    const principalForPeriod =
      paymentCents - Math.round(remainingCents * input.monthlyRate);
    if (principalForPeriod <= 0) {
      throw new Error('La cuota no alcanza a cubrir los intereses del periodo');
    }
    remainingCents -= Math.min(remainingCents, principalForPeriod);
    count += 1;
    if (count > MAX_LOAN_INSTALLMENTS) {
      throw new Error(
        `La tabla supera el máximo de ${MAX_LOAN_INSTALLMENTS} cuotas`,
      );
    }
  }
  return buildSchedule(input, principalCents, paymentCents, count);
}

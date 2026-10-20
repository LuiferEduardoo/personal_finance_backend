export interface InstallmentBreakdown {
  sequenceNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  amount: number;
}

const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (amount: number): number => amount / 100;

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().substring(0, 10);
}

/**
 * Tabla de amortización de cuota fija. Todos los redondeos se hacen en
 * centavos y la última cuota absorbe cualquier residuo del capital.
 */
export function calculateInstallments(
  principal: number,
  installmentCount: number,
  monthlyRate: number,
  firstDueDate: string,
): InstallmentBreakdown[] {
  const principalCents = toCents(principal);
  const rawPayment =
    monthlyRate === 0
      ? principalCents / installmentCount
      : (principalCents * monthlyRate * (1 + monthlyRate) ** installmentCount) /
        ((1 + monthlyRate) ** installmentCount - 1);
  const regularPaymentCents = Math.round(rawPayment);
  let remainingCents = principalCents;

  return Array.from({ length: installmentCount }, (_, index) => {
    const interestCents = Math.round(remainingCents * monthlyRate);
    const principalForPeriod =
      index === installmentCount - 1
        ? remainingCents
        : Math.min(remainingCents, regularPaymentCents - interestCents);
    const amountCents = principalForPeriod + interestCents;
    remainingCents -= principalForPeriod;

    return {
      sequenceNumber: index + 1,
      dueDate: addMonths(firstDueDate, index),
      principalAmount: fromCents(principalForPeriod),
      interestAmount: fromCents(interestCents),
      amount: fromCents(amountCents),
    };
  });
}

// Los presupuestos son por mes calendario ("YYYY-MM") según occurred_on.
export const BUDGET_TIME_ZONE = 'America/Bogota';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period);
}

// mes en curso en la zona horaria de Bogotá
export function currentPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUDGET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')!.value;
  const month = parts.find((part) => part.type === 'month')!.value;
  return `${year}-${month}`;
}

// "2026-11-05" -> "2026-11"
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

// "2026-11" -> "noviembre de 2026"
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

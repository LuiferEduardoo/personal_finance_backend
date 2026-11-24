import {
  LoanInstallmentBreakdown,
  calculateLoanSchedule,
  calculateLoanScheduleWithPayment,
  effectiveAnnualToMonthly,
  frenchPaymentCents,
} from './loan-calculator';

const cents = (value: number) => Math.round(value * 100);
const sumCents = (
  schedule: LoanInstallmentBreakdown[],
  pick: (item: LoanInstallmentBreakdown) => number,
) => schedule.reduce((sum, item) => sum + cents(pick(item)), 0);

describe('calculateLoanSchedule', () => {
  it('sin interés reparte el capital y la última absorbe el residuo', () => {
    const schedule = calculateLoanSchedule({
      principal: 100,
      installmentCount: 3,
      monthlyRate: 0,
      firstDueDate: '2026-01-31',
    });

    expect(schedule.map((item) => item.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(schedule.map((item) => item.interestAmount)).toEqual([0, 0, 0]);
    expect(schedule.map((item) => item.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(sumCents(schedule, (item) => item.principalAmount)).toBe(10_000);
  });

  it('con tasa: cuota fija, interés sobre saldo y capital exacto', () => {
    const schedule = calculateLoanSchedule({
      principal: 10_000_000,
      installmentCount: 36,
      monthlyRate: 0.015,
      firstDueDate: '2026-02-15',
    });

    expect(schedule).toHaveLength(36);
    expect(sumCents(schedule, (item) => item.principalAmount)).toBe(
      1_000_000_000,
    );
    const payment = frenchPaymentCents(1_000_000_000, 36, 0.015) / 100;
    // todas menos la última pagan exactamente la cuota fija
    for (const item of schedule.slice(0, -1)) {
      expect(item.amount).toBe(payment);
    }
    expect(Math.abs(schedule[35].amount - payment)).toBeLessThan(1);
    expect(schedule[0].interestAmount).toBe(150_000);
    expect(schedule[0].openingBalance).toBe(10_000_000);
    // el saldo inicial de cada periodo es el anterior menos su capital
    for (let i = 1; i < schedule.length; i++) {
      expect(cents(schedule[i].openingBalance)).toBe(
        cents(schedule[i - 1].openingBalance) -
          cents(schedule[i - 1].principalAmount),
      );
    }
  });

  it('cada cuota es capital + interés + cargos, en centavos exactos', () => {
    const schedule = calculateLoanSchedule({
      principal: 1_234_567.89,
      installmentCount: 17,
      monthlyRate: 0.0187,
      firstDueDate: '2026-03-10',
      charges: [
        { mode: 'fixed', value: 3_500.5 },
        { mode: 'percent_of_balance', value: 0.00105 },
      ],
    });

    for (const item of schedule) {
      expect(cents(item.amount)).toBe(
        cents(item.principalAmount) +
          cents(item.interestAmount) +
          cents(item.chargesAmount),
      );
      // todos los importes quedan en centavos
      for (const value of [
        item.amount,
        item.principalAmount,
        item.interestAmount,
        item.chargesAmount,
        item.openingBalance,
      ]) {
        expect(cents(value) / 100).toBe(value);
      }
    }
    expect(sumCents(schedule, (item) => item.principalAmount)).toBe(
      123_456_789,
    );
  });

  it('cargo FIXED suma el mismo valor a cada cuota', () => {
    const schedule = calculateLoanSchedule({
      principal: 1_200,
      installmentCount: 12,
      monthlyRate: 0,
      firstDueDate: '2026-01-01',
      charges: [{ mode: 'fixed', value: 15 }],
    });

    expect(schedule.every((item) => item.chargesAmount === 15)).toBe(true);
    expect(schedule.every((item) => item.amount === 115)).toBe(true);
  });

  it('cargo PERCENT_OF_BALANCE se calcula sobre el saldo inicial del periodo', () => {
    const schedule = calculateLoanSchedule({
      principal: 1_000_000,
      installmentCount: 4,
      monthlyRate: 0,
      firstDueDate: '2026-01-01',
      charges: [{ mode: 'percent_of_balance', value: 0.001 }],
    });

    expect(schedule.map((item) => item.openingBalance)).toEqual([
      1_000_000, 750_000, 500_000, 250_000,
    ]);
    expect(schedule.map((item) => item.chargesAmount)).toEqual([
      1_000, 750, 500, 250,
    ]);
  });

  it('continúa la numeración y las fechas desde startSequence', () => {
    const schedule = calculateLoanSchedule({
      principal: 300,
      installmentCount: 3,
      monthlyRate: 0,
      firstDueDate: '2026-01-31',
      startSequence: 4,
    });

    expect(schedule.map((item) => item.sequenceNumber)).toEqual([4, 5, 6]);
    expect(schedule.map((item) => item.dueDate)).toEqual([
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });
});

describe('calculateLoanScheduleWithPayment', () => {
  it('conserva la cuota y acorta el plazo, con la última más pequeña', () => {
    const schedule = calculateLoanScheduleWithPayment({
      principal: 1_000,
      payment: 300,
      monthlyRate: 0.01,
      firstDueDate: '2026-01-15',
    });

    expect(schedule).toHaveLength(4);
    expect(schedule.slice(0, 3).every((item) => item.amount === 300)).toBe(
      true,
    );
    expect(schedule[3].amount).toBeLessThan(300);
    expect(sumCents(schedule, (item) => item.principalAmount)).toBe(100_000);
  });

  it('rechaza una cuota que no cubre los intereses', () => {
    expect(() =>
      calculateLoanScheduleWithPayment({
        principal: 1_000,
        payment: 10,
        monthlyRate: 0.01,
        firstDueDate: '2026-01-15',
      }),
    ).toThrow();
  });
});

describe('effectiveAnnualToMonthly', () => {
  it('convierte EA a mensual equivalente', () => {
    const monthly = effectiveAnnualToMonthly(0.24);
    expect(monthly).toBeCloseTo(0.0180876, 7);
    expect((1 + monthly) ** 12 - 1).toBeCloseTo(0.24, 8);
  });

  it('EA cero es mensual cero y guarda máximo 10 decimales', () => {
    expect(effectiveAnnualToMonthly(0)).toBe(0);
    const monthly = effectiveAnnualToMonthly(0.1268);
    expect(Number(monthly.toFixed(10))).toBe(monthly);
  });
});

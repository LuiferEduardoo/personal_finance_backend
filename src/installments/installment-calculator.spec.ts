import { addMonths, calculateInstallments } from './installment-calculator';

describe('calculateInstallments', () => {
  it('distribuye el capital sin interés y conserva los centavos', () => {
    const installments = calculateInstallments(100, 3, 0, '2026-01-15');

    expect(installments.map((item) => item.amount)).toEqual([
      33.33, 33.33, 33.34,
    ]);
    expect(
      installments.reduce((sum, item) => sum + item.principalAmount, 0),
    ).toBe(100);
  });

  it('calcula interés sobre saldo y expone una cuota en cada mes', () => {
    const installments = calculateInstallments(1_000, 3, 0.02, '2026-01-31');

    expect(installments.map((item) => item.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(installments[0].interestAmount).toBe(20);
    expect(
      installments.reduce((sum, item) => sum + item.principalAmount, 0),
    ).toBe(1_000);
    expect(installments.reduce((sum, item) => sum + item.amount, 0)).toBe(
      1_040.27,
    );
  });
});

describe('addMonths', () => {
  it('ajusta el día al final de los meses cortos', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
});

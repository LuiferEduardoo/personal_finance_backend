import { trmRate } from './trm.service';

describe('trmRate', () => {
  const trm = 3192.92;

  it('convierte dólares a pesos con la TRM directa', () => {
    expect(99.11 * trmRate('USD', 'COP', trm)).toBeCloseTo(316450.30, 2);
  });

  it('convierte pesos a dólares con la TRM inversa', () => {
    expect(316450.3012 * trmRate('COP', 'USD', trm)).toBeCloseTo(99.11, 2);
  });
});

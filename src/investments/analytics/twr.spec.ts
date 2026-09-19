import { AnnualizedStatus } from './returns';
import { DayPoint, chainLink, returnBetween } from './twr';

const day = (date: string, endValue: number, externalFlow = 0): DayPoint => ({
  date,
  endValue,
  externalFlow,
});

describe('twr: encadenado básico', () => {
  it('el día de arranque toma el depósito como denominador', () => {
    const { days } = chainLink([day('2026-01-01', 1000, 1000)]);
    expect(days[0].factor).toBe(1);
    expect(days[0].index).toBe(100);
    expect(days[0].degenerate).toBe(false);
  });

  it('una subida del 10% da índice 110', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
    ]);
    expect(result.days[1].factor).toBeCloseTo(1.1, 10);
    expect(result.days[1].index).toBeCloseTo(110, 10);
    expect(result.totalReturn).toBeCloseTo(10, 4);
  });

  it('encadena varios días', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      day('2026-01-03', 1045), // -5%
    ]);
    // 1.10 * 0.95 = 1.045
    expect(result.totalReturn).toBeCloseTo(4.5, 4);
  });

  it('una caída da rentabilidad negativa', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 800),
    ]);
    expect(result.totalReturn).toBeCloseTo(-20, 4);
  });
});

describe('twr: neutralidad frente a los flujos', () => {
  // ESTA es la propiedad que define al TWR. Si falla, el indicador no sirve.
  it('un depósito NO mueve la rentabilidad', () => {
    const sinAporte = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      day('2026-01-03', 1210),
    ]);
    const conAporte = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      // mismo +10% del día, pero entran 5000 al empezar el día
      day('2026-01-03', (1100 + 5000) * 1.1, 5000),
    ]);
    expect(conAporte.totalReturn).toBeCloseTo(sinAporte.totalReturn!, 6);
    expect(conAporte.days[2].factor).toBeCloseTo(1.1, 10);
  });

  it('un retiro tampoco la mueve', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      day('2026-01-03', (1100 - 500) * 1.1, -500),
    ]);
    expect(result.days[2].factor).toBeCloseTo(1.1, 10);
    expect(result.totalReturn).toBeCloseTo(21, 4);
  });

  it('un día de solo aporte, sin movimiento de mercado, da factor 1', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 3000, 2000),
    ]);
    expect(result.days[1].factor).toBeCloseTo(1, 10);
    expect(result.totalReturn).toBeCloseTo(0, 6);
  });
});

describe('twr: días degenerados', () => {
  it('una cartera vacía no divide por cero', () => {
    const result = chainLink([
      day('2026-01-01', 0, 0),
      day('2026-01-02', 1000, 1000),
    ]);
    expect(result.days[0].degenerate).toBe(true);
    expect(result.days[0].factor).toBe(1);
    expect(Number.isFinite(result.totalReturn!)).toBe(true);
  });

  it('vaciar del todo y volver a financiar retoma la cadena', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      day('2026-01-03', 0, -1100), // se retira todo
      day('2026-01-04', 0), // día vacío
      day('2026-01-05', 2000, 2000), // se vuelve a financiar
      day('2026-01-06', 2200),
    ]);
    expect(result.days[3].degenerate).toBe(true);
    expect(result.days.every((d) => Number.isFinite(d.index))).toBe(true);
    // el +10% inicial y el +10% final se encadenan: 1.1 * 1.1 = 1.21
    expect(result.totalReturn).toBeCloseTo(21, 4);
  });

  it('serie vacía no rompe', () => {
    const result = chainLink([]);
    expect(result.days).toEqual([]);
    expect(result.totalReturn).toBeNull();
  });
});

describe('twr: anualización', () => {
  it('se SUPRIME por debajo de 365 días', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-03-01', 1200),
    ]);
    expect(result.totalReturn).toBeCloseTo(20, 4);
    expect(result.annualized.rate).toBeNull();
    expect(result.annualized.status).toBe(AnnualizedStatus.PERIOD_TOO_SHORT);
  });

  it('a un año exacto coincide con la rentabilidad total', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2027-01-01', 1200),
    ]);
    expect(result.annualized.status).toBe(AnnualizedStatus.OK);
    expect(result.annualized.rate).toBeCloseTo(20, 1);
  });

  it('dos años al 21% total dan ~10% anualizado', () => {
    const result = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2028-01-01', 1210),
    ]);
    expect(result.annualized.rate).toBeCloseTo(10, 0);
  });
});

describe('twr: consulta por rango sobre el índice persistido', () => {
  it('dos lecturas y una división bastan', () => {
    const { days } = chainLink([
      day('2026-01-01', 1000, 1000),
      day('2026-01-02', 1100),
      day('2026-01-03', 1045),
      day('2026-01-04', 1149.5),
    ]);
    // del día 2 al día 4: 1149.5 / 1100 - 1 = 4.5%
    expect(returnBetween(days[1].index, days[3].index)).toBeCloseTo(4.5, 4);
  });

  it('un índice base no positivo devuelve null', () => {
    expect(returnBetween(0, 110)).toBeNull();
  });
});

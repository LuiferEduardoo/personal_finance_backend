import { CashFlow, XirrStatus, xirr } from './xirr';

// Cada valor esperado se verificó comprobando que el VAN de la serie a esa
// tasa da ~0, con una bisección independiente. Los casos de un solo periodo
// son comprobables a mano (1000 -> 1100 en un año = 10%).
const flow = (date: string, amount: number): CashFlow => ({ date, amount });

describe('xirr: casos con respuesta conocida', () => {
  it('un año exacto al 10%', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 1100)]);
    expect(result.status).toBe(XirrStatus.OK);
    expect(result.rate).toBeCloseTo(10, 2);
  });

  it('duplicar en un año es 100%', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 2000)]);
    expect(result.rate).toBeCloseTo(100, 2);
  });

  it('serie irregular de varios aportes', () => {
    // aportes escalonados de 17 500 que acaban valiendo 20 000.
    // VAN(16.3906%) ~ 0, verificado con bisección independiente.
    const result = xirr([
      flow('2026-01-01', -10000),
      flow('2026-03-01', -5000),
      flow('2026-10-30', -2500),
      flow('2027-01-15', 20000),
    ]);
    expect(result.status).toBe(XirrStatus.OK);
    expect(result.rate).toBeCloseTo(16.3906, 2);
  });

  it('el resultado anula el VAN de la serie', () => {
    // la comprobación independiente del test anterior, hecha explícita:
    // cualquiera que sea la tasa devuelta, el VAN a esa tasa debe ser ~0
    const flows = [
      flow('2026-01-01', -10000),
      flow('2026-03-01', -5000),
      flow('2026-10-30', -2500),
      flow('2027-01-15', 20000),
    ];
    const rate = xirr(flows).rate! / 100;
    const start = Date.parse(`${flows[0].date}T00:00:00Z`);
    const npv = flows.reduce((sum, f) => {
      const years =
        (Date.parse(`${f.date}T00:00:00Z`) - start) / 86_400_000 / 365;
      return sum + f.amount / (1 + rate) ** years;
    }, 0);
    expect(Math.abs(npv)).toBeLessThan(0.01);
  });

  it('medio año al 21% anualizado', () => {
    // 1000 -> 1100 en 182 días: (1.1)^(365/182) - 1 ~ 21.02%
    const result = xirr([flow('2026-01-01', -1000), flow('2026-07-02', 1100)]);
    expect(result.rate).toBeCloseTo(21.02, 1);
  });

  it('una pérdida da tasa negativa', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 800)]);
    expect(result.status).toBe(XirrStatus.OK);
    expect(result.rate).toBeCloseTo(-20, 2);
  });

  it('pérdida casi total converge sin explotar', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 1)]);
    expect(result.status).toBe(XirrStatus.OK);
    expect(result.rate).toBeLessThan(-99);
    expect(Number.isFinite(result.rate!)).toBe(true);
  });

  it('un 10x en un año', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 10000)]);
    expect(result.status).toBe(XirrStatus.OK);
    expect(result.rate).toBeCloseTo(900, 1);
  });

  it('el orden de los flujos no importa', () => {
    const flows = [
      flow('2027-01-15', 20000),
      flow('2026-01-01', -10000),
      flow('2026-10-30', -2500),
      flow('2026-03-01', -5000),
    ];
    expect(xirr(flows).rate).toBeCloseTo(xirr([...flows].reverse()).rate!, 6);
  });
});

describe('xirr: fallos, siempre null y nunca NaN', () => {
  it('un solo flujo', () => {
    const result = xirr([flow('2026-01-01', -1000)]);
    expect(result).toEqual({ rate: null, status: XirrStatus.NOT_ENOUGH_FLOWS });
  });

  it('serie vacía', () => {
    expect(xirr([]).status).toBe(XirrStatus.NOT_ENOUGH_FLOWS);
  });

  it('todos los flujos el mismo día', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2026-01-01', 1100)]);
    expect(result.status).toBe(XirrStatus.NOT_ENOUGH_FLOWS);
  });

  it('solo aportes y ningún valor final', () => {
    const result = xirr([flow('2026-01-01', -1000), flow('2026-06-01', -500)]);
    expect(result).toEqual({ rate: null, status: XirrStatus.NO_SIGN_CHANGE });
  });

  it('solo salidas', () => {
    expect(
      xirr([flow('2026-01-01', 1000), flow('2026-06-01', 500)]).status,
    ).toBe(XirrStatus.NO_SIGN_CHANGE);
  });

  it('los flujos en cero se ignoran', () => {
    const result = xirr([
      flow('2026-01-01', -1000),
      flow('2026-06-01', 0),
      flow('2027-01-01', 1100),
    ]);
    expect(result.rate).toBeCloseTo(10, 2);
  });

  it('nunca devuelve NaN', () => {
    const casos: CashFlow[][] = [
      [flow('2026-01-01', -1000), flow('2027-01-01', 0.0001)],
      [flow('2026-01-01', -0.01), flow('2027-01-01', 1_000_000)],
      [flow('2026-01-01', -1e9), flow('2027-01-01', 1e9 + 1)],
    ];
    for (const caso of casos) {
      const { rate } = xirr(caso);
      expect(rate === null || Number.isFinite(rate)).toBe(true);
    }
  });
});

describe('xirr: escala y volumen', () => {
  it('la tolerancia es relativa: una cartera grande converge igual', () => {
    const pequena = xirr([flow('2026-01-01', -1000), flow('2027-01-01', 1100)]);
    const grande = xirr([
      flow('2026-01-01', -1_000_000_000),
      flow('2027-01-01', 1_100_000_000),
    ]);
    expect(grande.status).toBe(XirrStatus.OK);
    expect(grande.rate).toBeCloseTo(pequena.rate!, 4);
  });

  it('500 flujos mensuales resuelven rápido', () => {
    const flows: CashFlow[] = [];
    const start = new Date('2010-01-01T00:00:00Z');
    for (let i = 0; i < 499; i += 1) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i * 10);
      flows.push(flow(d.toISOString().substring(0, 10), -100));
    }
    flows.push(flow('2026-09-19', 90_000));

    const began = Date.now();
    const result = xirr(flows);
    expect(Date.now() - began).toBeLessThan(200);
    expect(result.status).toBe(XirrStatus.OK);
    expect(Number.isFinite(result.rate!)).toBe(true);
  });
});

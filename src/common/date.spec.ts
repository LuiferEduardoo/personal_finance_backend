import { toDateString } from './date';

describe('toDateString', () => {
  it('normaliza el Date que devuelve el driver de Postgres', () => {
    // pg parsea una columna `date` a la medianoche LOCAL de ese día
    const fromDriver = new Date(2025, 8, 1); // 1 de septiembre de 2025
    expect(toDateString(fromDriver)).toBe('2025-09-01');
  });

  it('es justo el caso que rompía el patrón ingenuo', () => {
    const fromDriver = new Date(2025, 8, 1);
    // String(date).substring(0, 10) daba "Mon Sep 01": basura que el proveedor
    // rechaza y que nunca casa en una comparación de fechas
    expect(String(fromDriver).substring(0, 10)).not.toBe('2025-09-01');
    expect(toDateString(fromDriver)).toBe('2025-09-01');
  });

  it('rellena mes y día con cero', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('deja pasar un string que ya viene en formato fecha', () => {
    expect(toDateString('2026-03-15')).toBe('2026-03-15');
    expect(toDateString('2026-03-15T10:00:00Z')).toBe('2026-03-15');
  });

  it('devuelve null sin valor', () => {
    expect(toDateString(null)).toBeNull();
    expect(toDateString(undefined)).toBeNull();
  });

  it('devuelve null ante una fecha inválida', () => {
    expect(toDateString(new Date('no es una fecha'))).toBeNull();
  });

  it('usa las partes locales, no UTC', () => {
    // una fecha a medianoche local en una zona al este de UTC daría el día
    // anterior con toISOString(); con partes locales no.
    const local = new Date(2026, 5, 10, 0, 0, 0);
    expect(toDateString(local)).toBe('2026-06-10');
  });
});

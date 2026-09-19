import { genericProfile } from './profiles/generic.profile';
import { hapiPortfolioProfile } from './profiles/hapi-portfolio.profile';
import { ibkrFlexCsvProfile } from './profiles/ibkr-flex-csv.profile';
import { xtbStatementProfile } from './profiles/xtb-statement.profile';
import { parseDate, parseNumber } from './spreadsheet-parser.service';

describe('parseNumber', () => {
  it('lee el formato americano', () => {
    expect(parseNumber('1,234.56', genericProfile)).toBe(1234.56);
    expect(parseNumber('1234.56', genericProfile)).toBe(1234.56);
  });

  it('lee los importes mixtos de la plantilla de Hapi', () => {
    expect(parseNumber('1,922.00', hapiPortfolioProfile)).toBe(1922);
    expect(parseNumber('0.00884', hapiPortfolioProfile)).toBe(0.00884);
    expect(parseNumber('16.99048', hapiPortfolioProfile)).toBe(16.99048);
    expect(parseNumber('0.15', hapiPortfolioProfile)).toBe(0.15);
  });

  it('lee el formato europeo', () => {
    expect(parseNumber('1.234,56', genericProfile)).toBe(1234.56);
    expect(parseNumber('1.234.567,89', genericProfile)).toBe(1234567.89);
  });

  it('el separador decimal es el que está más a la derecha', () => {
    // adivinarlo mal desplaza la coma y multiplica por mil
    expect(parseNumber('1.234,56', genericProfile)).toBe(1234.56);
    expect(parseNumber('1,234.56', genericProfile)).toBe(1234.56);
  });

  it('una coma con tres decimales es separador de miles, salvo que el perfil diga lo contrario', () => {
    expect(parseNumber('1,234', genericProfile)).toBe(1234);
    expect(parseNumber('1,234', xtbStatementProfile)).toBe(1.234);
  });

  it('lee negativos entre paréntesis', () => {
    expect(parseNumber('(1,234.56)', genericProfile)).toBe(-1234.56);
  });

  it('ignora símbolos de moneda y espacios', () => {
    expect(parseNumber('$ 1,500.00', genericProfile)).toBe(1500);
    expect(parseNumber('1 500,25 €', genericProfile)).toBe(1500.25);
  });

  it('devuelve null si no hay número', () => {
    expect(parseNumber('', genericProfile)).toBeNull();
    expect(parseNumber(undefined, genericProfile)).toBeNull();
    expect(parseNumber('N/A', genericProfile)).toBeNull();
    expect(parseNumber('-', genericProfile)).toBeNull();
  });

  it('respeta el signo negativo', () => {
    expect(parseNumber('-250.50', genericProfile)).toBe(-250.5);
  });
});

describe('parseDate', () => {
  it('acepta ISO tal cual', () => {
    expect(parseDate('2026-09-01', genericProfile)).toBe('2026-09-01');
    expect(parseDate('2026-09-01T14:30:00Z', genericProfile)).toBe(
      '2026-09-01',
    );
  });

  it('acepta el compacto de IBKR', () => {
    expect(parseDate('20260901', ibkrFlexCsvProfile)).toBe('2026-09-01');
  });

  it('DMY y MDY interpretan 01/09/2026 de forma distinta, y eso importa', () => {
    // el mismo texto: 1 de septiembre en Europa, 9 de enero en EE. UU.
    expect(parseDate('01/09/2026', xtbStatementProfile)).toBe('2026-09-01');
    expect(
      parseDate('01/09/2026', { ...genericProfile, dateOrder: 'MDY' }),
    ).toBe('2026-01-09');
  });

  it('interpreta la fecha de la plantilla de Hapi como día/mes/año', () => {
    expect(parseDate('04/02/2025', hapiPortfolioProfile)).toBe('2025-02-04');
  });

  it('acepta puntos y guiones como separador', () => {
    expect(parseDate('01.09.2026', xtbStatementProfile)).toBe('2026-09-01');
    expect(parseDate('01-09-2026', xtbStatementProfile)).toBe('2026-09-01');
  });

  it('expande un año de dos dígitos', () => {
    expect(parseDate('01/09/26', xtbStatementProfile)).toBe('2026-09-01');
  });

  it('rellena con ceros a la izquierda', () => {
    expect(parseDate('1/9/2026', xtbStatementProfile)).toBe('2026-09-01');
  });

  it('devuelve null si no hay fecha', () => {
    expect(parseDate('', genericProfile)).toBeNull();
    expect(parseDate(undefined, genericProfile)).toBeNull();
    expect(parseDate('no es una fecha', genericProfile)).toBeNull();
  });
});

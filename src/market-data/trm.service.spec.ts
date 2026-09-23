import { ServiceUnavailableException } from '@nestjs/common';
import { TrmService, trmRate } from './trm.service';

describe('trmRate', () => {
  const trm = 3192.92;

  it('convierte dólares a pesos con la TRM directa', () => {
    expect(99.11 * trmRate('USD', 'COP', trm)).toBeCloseTo(316450.30, 2);
  });

  it('convierte pesos a dólares con la TRM inversa', () => {
    expect(316450.3012 * trmRate('COP', 'USD', trm)).toBeCloseTo(99.11, 2);
  });
});

describe('TrmService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lee la respuesta actual de la Superfinanciera con una sola fecha', async () => {
    const html = `
      <tr class="filaPub4">
        <td style="text-align: center">TRM </td>
        <td style="text-align: center">COP</td>
        <td style="text-align: center">3,208.66</td>
        <td>23-Sep-2026</td>
      </tr>`;
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    await expect(new TrmService().latest()).resolves.toEqual({
      value: 3208.66,
      validFrom: '2026-09-23',
      validTo: '2026-09-23',
    });
  });

  it('mantiene compatibilidad con una vigencia expresada como rango', async () => {
    const html = `
      <td>TRM</td><td>COP</td><td>3,192.92</td>
      <td>20/Sep/2026 - 22/Sep/2026</td>`;
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    await expect(new TrmService().latest()).resolves.toEqual({
      value: 3192.92,
      validFrom: '2026-09-20',
      validTo: '2026-09-22',
    });
  });

  it('rechaza respuestas sin una TRM reconocible', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html>respuesta inesperada</html>',
    } as Response);

    await expect(new TrmService().latest()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

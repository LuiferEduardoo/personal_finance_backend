import { FxRateSource } from '../entities/investment-transaction.entity';
import { resolveImportedFx } from './import.service';

describe('resolveImportedFx', () => {
  it('mantiene tasa uno cuando la operación ya está en la moneda base', async () => {
    const rateForWrite = jest.fn<Promise<number>, [string, string, string]>();

    await expect(
      resolveImportedFx('USD', 'USD', '2026-09-19', rateForWrite),
    ).resolves.toEqual({
      fxRate: 1,
      fxRateSource: FxRateSource.ASSUMED_ONE,
    });
    expect(rateForWrite).not.toHaveBeenCalled();
  });

  it('congela la tasa hacia la moneda base al importar otra divisa', async () => {
    const rateForWrite = jest.fn().mockResolvedValue(0.00026);

    await expect(
      resolveImportedFx('COP', 'USD', '2026-09-19', rateForWrite),
    ).resolves.toEqual({
      fxRate: 0.00026,
      fxRateSource: FxRateSource.TWELVE_DATA,
    });
    expect(rateForWrite).toHaveBeenCalledWith('COP', 'USD', '2026-09-19');
  });
});

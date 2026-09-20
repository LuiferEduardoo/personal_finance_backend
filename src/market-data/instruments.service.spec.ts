import { InstrumentsService } from './instruments.service';
import {
  InstrumentAssetClass,
  InstrumentPriceSource,
} from './entities/instrument.entity';

describe('InstrumentsService.create', () => {
  const input = {
    symbol: 'meli',
    name: 'Mercado Libre',
    currency: 'USD',
    assetClass: InstrumentAssetClass.EQUITY,
    sector: 'Tecnología',
    twelveDataSymbol: 'meli',
  };

  function setup(existing: Record<string, unknown> | null = null) {
    const repository = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'instrument-id', ...value })),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const rootRepository = {
      manager: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
    };
    const service = new InstrumentsService(
      rootRepository as never,
      {} as never,
    );
    return { service, repository, manager };
  }

  it('crea el activo con ticker de Twelve Data y sector normalizados', async () => {
    const { service, repository, manager } = setup();

    await service.create(input);

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['MELI|'],
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'MELI',
        twelveDataSymbol: 'MELI',
        sector: 'Tecnología',
        priceSource: InstrumentPriceSource.MANUAL,
      }),
    );
  });

  it('reutiliza y enriquece el activo existente en vez de duplicarlo', async () => {
    const existing = {
      id: 'existing-id',
      symbol: 'MELI',
      exchange: null,
      twelveDataSymbol: null,
      sector: null,
    };
    const { service, repository } = setup(existing);

    const result = await service.create(input);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-id',
        twelveDataSymbol: 'MELI',
        sector: 'Tecnología',
      }),
    );
    expect(result.id).toBe('existing-id');
  });
});

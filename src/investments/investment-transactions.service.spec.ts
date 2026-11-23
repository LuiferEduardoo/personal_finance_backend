import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { FxService } from '../market-data/fx.service';
import { PricesService } from '../market-data/prices.service';
import { TrmService } from '../market-data/trm.service';
import { User } from '../users/entities/user.entity';
import { LedgerError } from './analytics/portfolio-ledger';
import { InvestmentLot } from './entities/investment-lot.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';
import { InvestmentAccountsService } from './investment-accounts.service';
import {
  BatchTransactionInput,
  InvestmentTransactionsService,
} from './investment-transactions.service';
import { PositionsService } from './positions.service';

const buy = (overrides: Partial<BatchTransactionInput> = {}) =>
  ({
    accountId: 'account-1',
    type: InvestmentTransactionType.BUY,
    instrumentId: 'inst-1',
    occurredOn: '2026-05-27',
    quantity: 0.081,
    price: 809.27,
    amount: 65.55087,
    currency: 'USD',
    occurrenceIndex: 0,
    externalId: '9000000001',
    raw: { source: 'test' },
    ...overrides,
  }) as BatchTransactionInput;

function setup(options: { rawInserted?: unknown[]; rebuild?: jest.Mock } = {}) {
  const values = jest.fn();
  const execute = jest
    .fn()
    .mockResolvedValue({ raw: options.rawInserted ?? [{ id: 'tx-1' }] });
  const builder = {
    insert: () => builder,
    into: () => builder,
    values: (rows: unknown[]) => {
      values(rows);
      return builder;
    },
    orIgnore: jest.fn(() => builder),
    returning: () => builder,
    execute,
  };
  const manager = { createQueryBuilder: () => builder };
  const dataSource = {
    transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const positions = { rebuild: options.rebuild ?? jest.fn() };
  const prices = { requestBackfill: jest.fn() };
  const accounts = { assertOwned: jest.fn() };
  const service = new InvestmentTransactionsService(
    {} as Repository<InvestmentTransaction>,
    {} as Repository<InvestmentLot>,
    {
      findOne: jest.fn().mockResolvedValue({ baseCurrency: 'USD' }),
    } as unknown as Repository<User>,
    accounts as unknown as InvestmentAccountsService,
    positions as unknown as PositionsService,
    prices as unknown as PricesService,
    {} as FxService,
    {} as TrmService,
    dataSource as unknown as DataSource,
  );
  return {
    service,
    values,
    builder,
    execute,
    manager,
    dataSource,
    positions,
    prices,
    accounts,
  };
}

describe('InvestmentTransactionsService.createBatch', () => {
  it('inserta todas las filas y reconstruye en UNA transacción', async () => {
    const ctx = setup({ rawInserted: [{ id: 'a' }, { id: 'b' }] });

    const result = await ctx.service.createBatch('user-1', 'account-1', [
      buy(),
      buy({ occurrenceIndex: 1, externalId: '9000000002' }),
      buy({ quantity: 1, amount: 809.27, externalId: '9000000003' }),
    ]);

    expect(result).toEqual({ inserted: 2, duplicates: 1 });
    expect(ctx.accounts.assertOwned).toHaveBeenCalledWith(
      'account-1',
      'user-1',
    );
    expect(ctx.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    expect(ctx.builder.orIgnore).toHaveBeenCalled();
    expect(ctx.positions.rebuild).toHaveBeenCalledWith(
      'user-1',
      ['account-1'],
      ctx.manager,
    );

    const rows = ctx.values.mock.calls[0][0] as InvestmentTransaction[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      amount: 65.55087,
      externalId: '9000000001',
      raw: { source: 'test' },
    });
    // la posición en el documento cambia el hash de dos filas idénticas
    expect(rows[0].dedupeHash).not.toBe(rows[1].dedupeHash);
    expect(new Set(rows.map((row) => row.dedupeHash)).size).toBe(3);
  });

  it('el externalId no entra en el hash: la misma orden por otra vía es duplicada', async () => {
    const ctx = setup();
    await ctx.service.createBatch('user-1', 'account-1', [
      buy(),
      buy({ externalId: 'otro' }),
    ]);
    const rows = ctx.values.mock.calls[0][0] as InvestmentTransaction[];
    expect(rows[0].dedupeHash).toBe(rows[1].dedupeHash);
  });

  it('una venta sin lotes deshace todo: error claro y sin histórico de precios', async () => {
    const ctx = setup({
      rebuild: jest
        .fn()
        .mockRejectedValue(new LedgerError('No hay cantidad suficiente')),
    });

    await expect(
      ctx.service.createBatch('user-1', 'account-1', [
        buy({ type: InvestmentTransactionType.SELL }),
      ]),
    ).rejects.toThrow(new BadRequestException('No hay cantidad suficiente'));

    // la excepción sale del callback: eso es lo que hace el ROLLBACK
    await expect(
      ctx.dataSource.transaction.mock.results[0].value,
    ).rejects.toThrow('No hay cantidad suficiente');
    expect(ctx.prices.requestBackfill).not.toHaveBeenCalled();
  });

  it('pide el histórico desde la fecha más antigua, una vez por instrumento', async () => {
    const ctx = setup();
    await ctx.service.createBatch('user-1', 'account-1', [
      buy({ occurredOn: '2026-05-27' }),
      buy({ occurredOn: '2026-05-20', externalId: 'b' }),
    ]);
    expect(ctx.prices.requestBackfill).toHaveBeenCalledTimes(1);
    expect(ctx.prices.requestBackfill).toHaveBeenCalledWith(
      'inst-1',
      '2026-05-20',
    );
  });

  it('si todo estaba registrado no pide histórico', async () => {
    const ctx = setup({ rawInserted: [] });
    await expect(
      ctx.service.createBatch('user-1', 'account-1', [buy()]),
    ).resolves.toEqual({ inserted: 0, duplicates: 1 });
    expect(ctx.prices.requestBackfill).not.toHaveBeenCalled();
  });

  it('un fallo pidiendo histórico no convierte en error lo ya guardado', async () => {
    const ctx = setup();
    ctx.prices.requestBackfill.mockRejectedValue(new Error('sin red'));
    await expect(
      ctx.service.createBatch('user-1', 'account-1', [buy()]),
    ).resolves.toEqual({ inserted: 1, duplicates: 0 });
  });
});

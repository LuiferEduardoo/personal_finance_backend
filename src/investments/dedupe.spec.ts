import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { DedupeInput, dedupeHash } from './dedupe';

const base: DedupeInput = {
  userId: 'user-1',
  accountId: 'acc-1',
  type: InvestmentTransactionType.BUY,
  occurredOn: '2026-01-15',
  instrumentId: 'inst-1',
  quantity: 10,
  amount: 1500,
  currency: 'USD',
  externalId: null,
  occurrenceIndex: 0,
};

describe('dedupeHash', () => {
  it('es estable entre llamadas', () => {
    expect(dedupeHash(base)).toBe(dedupeHash({ ...base }));
  });

  it('no depende de cómo el parser represente los números', () => {
    expect(dedupeHash({ ...base, quantity: 10.0, amount: 1500.0 })).toBe(
      dedupeHash(base),
    );
  });

  it('normaliza la moneda a mayúsculas', () => {
    expect(dedupeHash({ ...base, currency: 'usd' })).toBe(dedupeHash(base));
  });

  it('cambia si cambia cualquier campo significativo', () => {
    const original = dedupeHash(base);
    expect(dedupeHash({ ...base, quantity: 11 })).not.toBe(original);
    expect(dedupeHash({ ...base, amount: 1501 })).not.toBe(original);
    expect(dedupeHash({ ...base, occurredOn: '2026-01-16' })).not.toBe(
      original,
    );
    expect(dedupeHash({ ...base, accountId: 'acc-2' })).not.toBe(original);
    expect(
      dedupeHash({ ...base, type: InvestmentTransactionType.SELL }),
    ).not.toBe(original);
    expect(dedupeHash({ ...base, externalId: 'broker-99' })).not.toBe(original);
  });

  it('occurrenceIndex distingue dos operaciones genuinamente idénticas', () => {
    expect(dedupeHash({ ...base, occurrenceIndex: 1 })).not.toBe(
      dedupeHash(base),
    );
  });

  it('usuarios distintos no colisionan con la misma operación', () => {
    expect(dedupeHash({ ...base, userId: 'user-2' })).not.toBe(
      dedupeHash(base),
    );
  });
});

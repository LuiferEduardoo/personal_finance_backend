import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
import {
  LedgerError,
  LedgerEvent,
  replay,
  replayDaily,
} from './portfolio-ledger';

const ACCOUNT = 'acc-1';
const OTHER_ACCOUNT = 'acc-2';
const AAPL = 'inst-aapl';

let counter = 0;

function event(partial: Partial<LedgerEvent>): LedgerEvent {
  counter += 1;
  return {
    id: `tx-${String(counter).padStart(4, '0')}`,
    accountId: ACCOUNT,
    type: InvestmentTransactionType.BUY,
    instrumentId: AAPL,
    occurredOn: '2026-01-01',
    occurredAt: null,
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    tax: 0,
    currency: 'USD',
    fxRate: 1,
    settlementCurrency: null,
    settlementAmount: null,
    splitRatioNumerator: null,
    splitRatioDenominator: null,
    counterpartyAccountId: null,
    ...partial,
  };
}

const buy = (
  quantity: number,
  price: number,
  occurredOn: string,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent =>
  event({
    type: InvestmentTransactionType.BUY,
    quantity,
    price,
    amount: quantity * price,
    occurredOn,
    ...extra,
  });

const sell = (
  quantity: number,
  price: number,
  occurredOn: string,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent =>
  event({
    type: InvestmentTransactionType.SELL,
    quantity,
    price,
    amount: quantity * price,
    occurredOn,
    ...extra,
  });

const position = (state: ReturnType<typeof replay>, accountId = ACCOUNT) =>
  state.positions.find(
    (p) => p.accountId === accountId && p.instrumentId === AAPL,
  );

const cashOf = (
  state: ReturnType<typeof replay>,
  currency = 'USD',
  accountId = ACCOUNT,
) =>
  state.cash.find((c) => c.accountId === accountId && c.currency === currency)
    ?.amount ?? 0;

const realizedTotal = (state: ReturnType<typeof replay>) =>
  state.realizations.reduce((sum, r) => sum + r.realizedPnl, 0);

beforeEach(() => {
  counter = 0;
});

describe('portfolio-ledger: BUY', () => {
  it('abre un lote y descuenta el efectivo', () => {
    const state = replay([buy(10, 150, '2026-01-01')]);

    expect(state.lots).toHaveLength(1);
    expect(state.lots[0].quantityOpen).toBe(10);
    expect(state.lots[0].costPerUnit).toBe(150);
    expect(cashOf(state)).toBe(-1500);
    expect(position(state)!.quantity).toBe(10);
  });

  it('CAPITALIZA comisión e impuesto en la base de costo', () => {
    const state = replay([buy(10, 150, '2026-01-01', { fee: 10, tax: 5 })]);

    // (1500 + 10 + 5) / 10
    expect(state.lots[0].costPerUnit).toBe(151.5);
    expect(state.lots[0].costBasisIsEstimated).toBe(false);
    expect(cashOf(state)).toBe(-1515);
    expect(position(state)!.costBasis).toBe(1515);
  });

  it('guarda la base en moneda base con la tasa congelada', () => {
    const state = replay([buy(10, 150, '2026-01-01', { fxRate: 4000 })]);

    expect(state.lots[0].costPerUnit).toBe(150);
    expect(state.lots[0].costPerUnitBase).toBe(600_000);
  });
});

describe('portfolio-ledger: SELL y FIFO', () => {
  it('consume los lotes más antiguos primero, no el promedio', () => {
    const state = replay([
      buy(10, 150, '2026-01-01'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
    ]);

    // FIFO: 10 x (200-150) + 5 x (200-170) = 500 + 150 = 650
    // Promedio ponderado habría dado 15 x (200-160) = 600. No es lo mismo.
    expect(realizedTotal(state)).toBe(650);
    expect(position(state)!.quantity).toBe(5);
    expect(position(state)!.costBasis).toBe(850); // 5 x 170
  });

  it('genera una realización por cada lote consumido', () => {
    const state = replay([
      buy(10, 150, '2026-01-01'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
    ]);

    expect(state.realizations).toHaveLength(2);
    expect(state.realizations[0]).toMatchObject({
      quantity: 10,
      costPerUnit: 150,
      realizedPnl: 500,
      disposition: 'sale',
    });
    expect(state.realizations[1]).toMatchObject({
      quantity: 5,
      costPerUnit: 170,
      realizedPnl: 150,
    });
  });

  it('NETEA comisión e impuesto del producto de la venta', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      sell(10, 200, '2026-03-01', { fee: 20, tax: 30 }),
    ]);

    // producto neto 2000 - 20 - 30 = 1950 -> 195/unidad
    expect(realizedTotal(state)).toBe(950);
    expect(cashOf(state)).toBe(950); // -1000 + 1950
  });

  it('cierra el lote cuando se consume entero', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      sell(10, 120, '2026-02-01'),
    ]);

    expect(state.lots[0].quantityOpen).toBe(0);
    expect(state.lots[0].closedOn).toBe('2026-02-01');
    expect(position(state)!.quantity).toBe(0);
  });

  it('falla al vender más de lo que hay', () => {
    expect(() =>
      replay([buy(5, 100, '2026-01-01'), sell(10, 120, '2026-02-01')]),
    ).toThrow(LedgerError);
  });

  it('permite comprar y vender el mismo día sin hora', () => {
    const state = replay([
      sell(5, 120, '2026-01-01'),
      buy(10, 100, '2026-01-01'),
    ]);

    expect(position(state)!.quantity).toBe(5);
    expect(realizedTotal(state)).toBe(100);
  });

  it('respeta occurredAt cuando el bróker da la hora', () => {
    const state = replay([
      buy(10, 100, '2026-01-01', {
        occurredAt: new Date('2026-01-01T09:00:00Z'),
      }),
      buy(10, 200, '2026-01-01', {
        occurredAt: new Date('2026-01-01T15:00:00Z'),
      }),
      sell(10, 300, '2026-01-01', {
        occurredAt: new Date('2026-01-01T16:00:00Z'),
      }),
    ]);

    // consume el lote de las 09:00 (costo 100), no el de las 15:00
    expect(realizedTotal(state)).toBe(2000);
  });
});

describe('portfolio-ledger: SPLIT', () => {
  it('duplica la cantidad y deja la base TOTAL invariante', () => {
    const state = replay([
      buy(10, 150, '2026-01-01'),
      event({
        type: InvestmentTransactionType.SPLIT,
        occurredOn: '2026-02-01',
        splitRatioNumerator: 2,
        splitRatioDenominator: 1,
      }),
    ]);

    expect(position(state)!.quantity).toBe(20);
    expect(position(state)!.costBasis).toBe(1500);
    expect(state.lots[0].costPerUnit).toBe(75);
    expect(cashOf(state)).toBe(-1500); // no mueve efectivo
  });

  it('un split inverso reduce la cantidad y sube el costo unitario', () => {
    const state = replay([
      buy(100, 10, '2026-01-01'),
      event({
        type: InvestmentTransactionType.SPLIT,
        occurredOn: '2026-02-01',
        splitRatioNumerator: 1,
        splitRatioDenominator: 10,
      }),
    ]);

    expect(position(state)!.quantity).toBe(10);
    expect(position(state)!.costBasis).toBe(1000);
    expect(state.lots[0].costPerUnit).toBe(100);
  });

  it('una venta posterior al split usa la base ya ajustada', () => {
    const state = replay([
      buy(10, 150, '2026-01-01'),
      event({
        type: InvestmentTransactionType.SPLIT,
        occurredOn: '2026-02-01',
        splitRatioNumerator: 2,
        splitRatioDenominator: 1,
      }),
      sell(20, 100, '2026-03-01'),
    ]);

    // 20 x (100 - 75) = 500
    expect(realizedTotal(state)).toBe(500);
    expect(position(state)!.quantity).toBe(0);
  });

  it('un split posterior a una venta solo afecta a los lotes que quedan', () => {
    const state = replay([
      buy(20, 100, '2026-01-01'),
      sell(10, 150, '2026-02-01'),
      event({
        type: InvestmentTransactionType.SPLIT,
        occurredOn: '2026-03-01',
        splitRatioNumerator: 2,
        splitRatioDenominator: 1,
      }),
    ]);

    expect(realizedTotal(state)).toBe(500);
    expect(position(state)!.quantity).toBe(20);
    expect(position(state)!.costBasis).toBe(1000);
  });

  it('exige una proporción válida', () => {
    expect(() =>
      replay([
        buy(10, 100, '2026-01-01'),
        event({
          type: InvestmentTransactionType.SPLIT,
          occurredOn: '2026-02-01',
          splitRatioNumerator: 0,
          splitRatioDenominator: 1,
        }),
      ]),
    ).toThrow(LedgerError);
  });
});

describe('portfolio-ledger: transferencias', () => {
  it('TRANSFER_IN con precio abre un lote con base exacta', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.TRANSFER_IN,
        occurredOn: '2026-01-01',
        quantity: 10,
        price: 120,
      }),
    ]);

    expect(state.lots[0].costPerUnit).toBe(120);
    expect(state.lots[0].costBasisIsEstimated).toBe(false);
    expect(cashOf(state)).toBe(0); // no mueve efectivo
  });

  it('TRANSFER_IN sin precio cae al precio de mercado y lo MARCA como estimado', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.TRANSFER_IN,
        occurredOn: '2026-01-01',
        quantity: 10,
        marketPriceHint: 95,
      }),
    ]);

    expect(state.lots[0].costPerUnit).toBe(95);
    expect(state.lots[0].costBasisIsEstimated).toBe(true);
    expect(position(state)!.costBasisIsEstimated).toBe(true);
  });

  it('TRANSFER_IN sin precio ni mercado deja base 0 marcada, no rompe', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.TRANSFER_IN,
        occurredOn: '2026-01-01',
        quantity: 10,
      }),
    ]);

    expect(state.lots[0].costPerUnit).toBe(0);
    expect(state.lots[0].costBasisIsEstimated).toBe(true);
  });

  it('TRANSFER_OUT no realiza P&L', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.TRANSFER_OUT,
        occurredOn: '2026-02-01',
        quantity: 10,
      }),
    ]);

    expect(realizedTotal(state)).toBe(0);
    expect(state.realizations[0].disposition).toBe('transfer_out');
    expect(position(state)!.quantity).toBe(0);
  });

  it('TRANSFER_OUT con destino reabre el lote conservando base y fecha', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.TRANSFER_OUT,
        occurredOn: '2026-06-01',
        quantity: 10,
        counterpartyAccountId: OTHER_ACCOUNT,
      }),
    ]);

    const moved = state.lots.find((lot) => lot.accountId === OTHER_ACCOUNT);
    expect(moved).toBeDefined();
    expect(moved!.costPerUnit).toBe(100);
    expect(moved!.openedOn).toBe('2026-01-01'); // fecha original, no la del traslado
    expect(position(state, OTHER_ACCOUNT)!.quantity).toBe(10);
    expect(position(state)!.quantity).toBe(0);
  });

  it('una venta tras la transferencia usa la base heredada', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.TRANSFER_OUT,
        occurredOn: '2026-06-01',
        quantity: 10,
        counterpartyAccountId: OTHER_ACCOUNT,
      }),
      sell(10, 150, '2026-07-01', { accountId: OTHER_ACCOUNT }),
    ]);

    expect(realizedTotal(state)).toBe(500);
  });
});

describe('portfolio-ledger: efectivo e ingresos', () => {
  it('DEPOSIT suma efectivo y cuenta como capital aportado', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 5000,
      }),
    ]);

    expect(cashOf(state)).toBe(5000);
    expect(state.contributionsBase).toBe(5000);
    expect(state.flows).toEqual([
      { date: '2026-01-01', accountId: ACCOUNT, amountBase: 5000 },
    ]);
  });

  it('convierte un aporte en USD a COP cuando COP es la moneda base', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        currency: 'USD',
        amount: 1000,
        fxRate: 4000,
      }),
    ]);

    expect(cashOf(state, 'USD')).toBe(1000);
    expect(state.contributionsBase).toBe(4_000_000);
    expect(state.flows[0]?.amountBase).toBe(4_000_000);
  });

  it('WITHDRAWAL resta efectivo y registra flujo negativo', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 5000,
      }),
      event({
        type: InvestmentTransactionType.WITHDRAWAL,
        instrumentId: null,
        occurredOn: '2026-02-01',
        amount: 2000,
      }),
    ]);

    expect(cashOf(state)).toBe(3000);
    expect(state.withdrawalsBase).toBe(2000);
    expect(state.flows[1].amountBase).toBe(-2000);
  });

  it('DIVIDEND suma neto de retención y se reporta como ingreso, no como realizado', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.DIVIDEND,
        occurredOn: '2026-03-01',
        amount: 100,
        tax: 15,
      }),
    ]);

    expect(state.income.dividendsBase).toBe(85);
    expect(state.income.taxesBase).toBe(15);
    expect(realizedTotal(state)).toBe(0);
    expect(cashOf(state)).toBe(-915); // -1000 + 85
    // el dividendo NO toca la base de costo
    expect(position(state)!.costBasis).toBe(1000);
  });

  it('INTEREST se acumula aparte de los dividendos', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.INTEREST,
        instrumentId: null,
        occurredOn: '2026-03-01',
        amount: 40,
      }),
    ]);

    expect(state.income.interestBase).toBe(40);
    expect(state.income.dividendsBase).toBe(0);
  });

  it('un FEE suelto NUNCA toca la base de costo, ni con instrumento', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.FEE,
        occurredOn: '2026-02-01',
        amount: 25,
      }),
    ]);

    expect(position(state)!.costBasis).toBe(1000);
    expect(state.lots[0].costPerUnit).toBe(100);
    expect(state.income.feesBase).toBe(25);
    expect(cashOf(state)).toBe(-1025);
    // y no es flujo externo: el TWR debe verlo como caída de valor
    expect(state.flows).toHaveLength(0);
  });

  it('un TAX suelto tampoco toca la base', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.TAX,
        instrumentId: null,
        occurredOn: '2026-02-01',
        amount: 40,
      }),
    ]);

    expect(position(state)!.costBasis).toBe(1000);
    expect(state.income.taxesBase).toBe(40);
    expect(state.flows).toHaveLength(0);
  });

  it('CURRENCY_EXCHANGE mueve efectivo entre dos monedas de la misma cuenta', () => {
    const state = replay([
      event({
        type: InvestmentTransactionType.CURRENCY_EXCHANGE,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 1000,
        currency: 'USD',
        settlementCurrency: 'EUR',
        settlementAmount: 920,
      }),
    ]);

    expect(cashOf(state, 'USD')).toBe(-1000);
    expect(cashOf(state, 'EUR')).toBe(920);
    expect(realizedTotal(state)).toBe(0);
  });

  it('CURRENCY_EXCHANGE exige moneda e importe de liquidación', () => {
    expect(() =>
      replay([
        event({
          type: InvestmentTransactionType.CURRENCY_EXCHANGE,
          instrumentId: null,
          occurredOn: '2026-01-01',
          amount: 1000,
        }),
      ]),
    ).toThrow(LedgerError);
  });
});

describe('portfolio-ledger: determinismo', () => {
  it('el orden de entrada no cambia el resultado', () => {
    const events = [
      buy(10, 150, '2026-01-01'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
      event({
        type: InvestmentTransactionType.DIVIDEND,
        occurredOn: '2026-02-15',
        amount: 50,
      }),
    ];

    const forward = replay(events);
    const backward = replay([...events].reverse());

    expect(realizedTotal(backward)).toBe(realizedTotal(forward));
    expect(position(backward)!.quantity).toBe(position(forward)!.quantity);
    expect(position(backward)!.costBasis).toBe(position(forward)!.costBasis);
    expect(cashOf(backward)).toBe(cashOf(forward));
  });

  it('el realizado y el no realizado salen de la misma pasada', () => {
    const state = replay([
      buy(10, 100, '2026-01-01'),
      buy(10, 200, '2026-02-01'),
      sell(12, 250, '2026-03-01'),
    ]);

    // realizado FIFO: 10x(250-100) + 2x(250-200) = 1500 + 100 = 1600
    expect(realizedTotal(state)).toBe(1600);
    // lo que queda son 8 unidades del segundo lote a 200
    expect(position(state)!.quantity).toBe(8);
    expect(position(state)!.costBasis).toBe(1600);
    expect(position(state)!.averageCost).toBe(200);
    expect(position(state)!.realizedPnlToDateBase).toBe(1600);
  });
});

describe('portfolio-ledger: checkpoints diarios', () => {
  it('emite una foto por cada fecha con actividad, no por día natural', () => {
    const { checkpoints } = replayDaily([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 5000,
      }),
      buy(10, 150, '2026-01-02'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
    ]);

    expect(checkpoints.map((c) => c.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('cada foto acumula el estado hasta esa fecha', () => {
    const { checkpoints } = replayDaily([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 5000,
      }),
      buy(10, 150, '2026-01-02'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
    ]);

    const [dia1, dia2, dia3, dia4] = checkpoints;
    expect(dia1.contributionsBase).toBe(5000);
    expect(dia1.positions).toHaveLength(0);

    expect(dia2.positions[0].quantity).toBe(10);
    expect(dia2.realizedToDateBase).toBe(0);

    expect(dia3.positions[0].quantity).toBe(20);

    expect(dia4.positions[0].quantity).toBe(5);
    expect(dia4.realizedToDateBase).toBe(650);
  });

  it('netFlowBase es el flujo externo de ESE día, no el acumulado', () => {
    const { checkpoints } = replayDaily([
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-01-01',
        amount: 5000,
      }),
      event({
        type: InvestmentTransactionType.DEPOSIT,
        instrumentId: null,
        occurredOn: '2026-02-01',
        amount: 3000,
      }),
      event({
        type: InvestmentTransactionType.WITHDRAWAL,
        instrumentId: null,
        occurredOn: '2026-03-01',
        amount: 1000,
      }),
    ]);

    expect(checkpoints.map((c) => c.netFlowBase)).toEqual([5000, 3000, -1000]);
    expect(checkpoints.map((c) => c.contributionsBase)).toEqual([
      5000, 8000, 8000,
    ]);
  });

  it('un dividendo NO cuenta como flujo externo del día', () => {
    const { checkpoints } = replayDaily([
      buy(10, 100, '2026-01-01'),
      event({
        type: InvestmentTransactionType.DIVIDEND,
        occurredOn: '2026-02-01',
        amount: 100,
        tax: 15,
      }),
    ]);

    const dividendo = checkpoints[1];
    expect(dividendo.netFlowBase).toBe(0);
    expect(dividendo.dividendsToDateBase).toBe(85);
  });

  it('el estado final coincide con el de replay()', () => {
    const events = [
      buy(10, 150, '2026-01-01'),
      buy(10, 170, '2026-02-01'),
      sell(15, 200, '2026-03-01'),
    ];
    const directo = replay(events);
    const { state } = replayDaily(events);

    expect(state.positions).toEqual(directo.positions);
    expect(state.cash).toEqual(directo.cash);
    expect(state.realizations.map((r) => r.realizedPnl)).toEqual(
      directo.realizations.map((r) => r.realizedPnl),
    );
  });
});

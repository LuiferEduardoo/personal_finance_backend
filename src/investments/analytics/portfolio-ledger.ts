import { randomUUID } from 'crypto';
import {
  EXTERNAL_FLOW_TYPES,
  InvestmentTransactionType,
} from '../../common/enums/investment-transaction-type.enum';
import { RealizationDisposition } from '../../common/enums/realization-disposition.enum';
import {
  addMoney,
  addQuantity,
  isNegativeQuantity,
  isZeroQuantity,
  roundMoney,
  roundPrice,
  roundQuantity,
  safeDivide,
  toBase,
} from './money';

// ---------------------------------------------------------------------------
// Este archivo es la ÚNICA implementación del efecto de las 12 operaciones
// sobre el efectivo, la cantidad y la base de costo. Tanto el camino
// incremental de escritura como el de reconstrucción completa pasan por
// `replay()`, así que no pueden discrepar.
//
// Es puro: cero Nest, cero TypeORM, cero E/S. Todo lo que necesita llega por
// parámetro. Esa es la razón de que sea la parte del sistema con tests de
// verdad.
// ---------------------------------------------------------------------------

export interface LedgerEvent {
  id: string;
  accountId: string;
  type: InvestmentTransactionType;
  instrumentId: string | null;
  occurredOn: string;
  occurredAt: Date | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  fxRate: number;
  settlementCurrency: string | null;
  settlementAmount: number | null;
  splitRatioNumerator: number | null;
  splitRatioDenominator: number | null;
  counterpartyAccountId: string | null;
  // precio de mercado del día, para resolver la base de un TRANSFER_IN que no
  // trae precio. Lo inyecta el servicio desde el caché; el reductor no hace E/S.
  marketPriceHint?: number | null;
}

export interface LedgerLot {
  id: string;
  accountId: string;
  instrumentId: string;
  openTransactionId: string | null;
  openedOn: string;
  quantityOriginal: number;
  quantityOpen: number;
  costPerUnit: number;
  currency: string;
  costPerUnitBase: number;
  costBasisIsEstimated: boolean;
  closedOn: string | null;
  // desempate FIFO cuando dos lotes comparten fecha; refleja el orden en que
  // se procesaron los eventos
  sequence: number;
}

export interface LedgerRealization {
  id: string;
  accountId: string;
  instrumentId: string;
  sellTransactionId: string;
  lotId: string;
  quantity: number;
  proceedsPerUnit: number;
  costPerUnit: number;
  realizedPnl: number;
  realizedPnlBase: number;
  currency: string;
  realizedOn: string;
  disposition: RealizationDisposition;
  costBasisIsEstimated: boolean;
}

export interface LedgerPosition {
  accountId: string;
  instrumentId: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  costBasisBase: number;
  currency: string;
  realizedPnlToDateBase: number;
  costBasisIsEstimated: boolean;
  lastTransactionOn: string | null;
}

export interface LedgerCash {
  accountId: string;
  currency: string;
  amount: number;
}

// flujo EXTERNO diario en moneda base: entra al denominador del TWR y a la
// serie del XIRR. Dividendos, intereses, comisiones e impuestos NO están aquí.
export interface LedgerFlow {
  date: string;
  accountId: string;
  amountBase: number;
}

export interface LedgerIncome {
  dividendsBase: number;
  interestBase: number;
  feesBase: number;
  taxesBase: number;
}

export interface LedgerState {
  lots: LedgerLot[];
  realizations: LedgerRealization[];
  positions: LedgerPosition[];
  cash: LedgerCash[];
  flows: LedgerFlow[];
  income: LedgerIncome;
  contributionsBase: number;
  withdrawalsBase: number;
}

// Estado acumulado del libro al CIERRE de una fecha con actividad. Entre dos
// fechas con actividad nada cambia salvo los precios, así que basta un
// checkpoint por fecha con eventos: el llamador interpola los días intermedios.
export interface LedgerCheckpoint {
  date: string;
  positions: LedgerPosition[];
  cash: LedgerCash[];
  contributionsBase: number;
  withdrawalsBase: number;
  realizedToDateBase: number;
  dividendsToDateBase: number;
  /** flujo externo NETO de ESE día, en moneda base */
  netFlowBase: number;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

// Orden de proceso dentro de un mismo día cuando el bróker no da la hora.
// Las entradas van antes que las salidas para que comprar y vender el mismo
// día no falle por "cantidad insuficiente", y el SPLIT va antes de la venta
// porque así es como ocurre en la realidad.
const TYPE_ORDER: Record<InvestmentTransactionType, number> = {
  [InvestmentTransactionType.TRANSFER_IN]: 0,
  [InvestmentTransactionType.DEPOSIT]: 1,
  [InvestmentTransactionType.BUY]: 2,
  [InvestmentTransactionType.SPLIT]: 3,
  [InvestmentTransactionType.DIVIDEND]: 4,
  [InvestmentTransactionType.INTEREST]: 5,
  [InvestmentTransactionType.CURRENCY_EXCHANGE]: 6,
  [InvestmentTransactionType.SELL]: 7,
  [InvestmentTransactionType.TRANSFER_OUT]: 8,
  [InvestmentTransactionType.FEE]: 9,
  [InvestmentTransactionType.TAX]: 10,
  [InvestmentTransactionType.WITHDRAWAL]: 11,
};

export function sortEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurredOn !== b.occurredOn) {
      return a.occurredOn < b.occurredOn ? -1 : 1;
    }
    const ta = a.occurredAt ? a.occurredAt.getTime() : null;
    const tb = b.occurredAt ? b.occurredAt.getTime() : null;
    if (ta !== null && tb !== null && ta !== tb) {
      return ta - tb;
    }
    const oa = TYPE_ORDER[a.type];
    const ob = TYPE_ORDER[b.type];
    if (oa !== ob) {
      return oa - ob;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const key = (accountId: string, instrumentId: string): string =>
  `${accountId}|${instrumentId}`;

const cashKey = (accountId: string, currency: string): string =>
  `${accountId}|${currency}`;

interface ReplayContext {
  lots: Map<string, LedgerLot[]>;
  realizations: LedgerRealization[];
  cash: Map<string, LedgerCash>;
  flows: LedgerFlow[];
  income: LedgerIncome;
  contributionsBase: number;
  withdrawalsBase: number;
  lastTransactionOn: Map<string, string>;
  realizedByPosition: Map<string, number>;
  sequence: number;
}

function createContext(): ReplayContext {
  return {
    lots: new Map(),
    realizations: [],
    cash: new Map(),
    flows: [],
    income: {
      dividendsBase: 0,
      interestBase: 0,
      feesBase: 0,
      taxesBase: 0,
    },
    contributionsBase: 0,
    withdrawalsBase: 0,
    lastTransactionOn: new Map(),
    realizedByPosition: new Map(),
    sequence: 0,
  };
}

export function replay(events: LedgerEvent[]): LedgerState {
  const ctx = createContext();
  for (const event of sortEvents(events)) {
    applyEvent(ctx, event);
  }
  return toState(ctx);
}

// Igual que replay(), pero devolviendo además una foto por cada fecha con
// actividad. Comparte el MISMO reductor: no hay una segunda implementación de
// las 12 operaciones que pueda desviarse.
export function replayDaily(events: LedgerEvent[]): {
  state: LedgerState;
  checkpoints: LedgerCheckpoint[];
} {
  const ctx = createContext();
  const checkpoints: LedgerCheckpoint[] = [];
  const sorted = sortEvents(events);

  let index = 0;
  while (index < sorted.length) {
    const date = sorted[index].occurredOn;
    let netFlowBase = 0;
    const flowsBefore = ctx.flows.length;

    while (index < sorted.length && sorted[index].occurredOn === date) {
      applyEvent(ctx, sorted[index]);
      index += 1;
    }
    for (let i = flowsBefore; i < ctx.flows.length; i += 1) {
      netFlowBase = addMoney(netFlowBase, ctx.flows[i].amountBase);
    }

    checkpoints.push({
      date,
      positions: buildPositions(ctx).map((position) => ({ ...position })),
      cash: [...ctx.cash.values()].map((balance) => ({ ...balance })),
      contributionsBase: roundMoney(ctx.contributionsBase),
      withdrawalsBase: roundMoney(ctx.withdrawalsBase),
      realizedToDateBase: ctx.realizations.reduce(
        (sum, realization) => addMoney(sum, realization.realizedPnlBase),
        0,
      ),
      dividendsToDateBase: ctx.income.dividendsBase,
      netFlowBase,
    });
  }

  return { state: toState(ctx), checkpoints };
}

function toState(ctx: ReplayContext): LedgerState {
  return {
    lots: [...ctx.lots.values()].flat(),
    realizations: ctx.realizations,
    positions: buildPositions(ctx),
    cash: [...ctx.cash.values()],
    flows: ctx.flows,
    income: ctx.income,
    contributionsBase: roundMoney(ctx.contributionsBase),
    withdrawalsBase: roundMoney(ctx.withdrawalsBase),
  };
}

function applyEvent(ctx: ReplayContext, event: LedgerEvent): void {
  switch (event.type) {
    case InvestmentTransactionType.BUY:
      applyBuy(ctx, event);
      break;
    case InvestmentTransactionType.SELL:
      applyDisposal(ctx, event, RealizationDisposition.SALE);
      break;
    case InvestmentTransactionType.DIVIDEND:
    case InvestmentTransactionType.INTEREST:
      applyIncome(ctx, event);
      break;
    case InvestmentTransactionType.DEPOSIT:
      applyDeposit(ctx, event);
      break;
    case InvestmentTransactionType.WITHDRAWAL:
      applyWithdrawal(ctx, event);
      break;
    case InvestmentTransactionType.FEE:
    case InvestmentTransactionType.TAX:
      applyCharge(ctx, event);
      break;
    case InvestmentTransactionType.SPLIT:
      applySplit(ctx, event);
      break;
    case InvestmentTransactionType.TRANSFER_IN:
      applyTransferIn(ctx, event);
      break;
    case InvestmentTransactionType.TRANSFER_OUT:
      applyDisposal(ctx, event, RealizationDisposition.TRANSFER_OUT);
      break;
    case InvestmentTransactionType.CURRENCY_EXCHANGE:
      applyCurrencyExchange(ctx, event);
      break;
  }
  if (event.instrumentId) {
    touchPosition(ctx, event.accountId, event.instrumentId, event.occurredOn);
  }
}

// --- BUY: las comisiones e impuestos del trade se CAPITALIZAN en la base ---

function applyBuy(ctx: ReplayContext, event: LedgerEvent): void {
  const quantity = requireQuantity(event);
  const instrumentId = requireInstrument(event);
  const totalCost = roundMoney(event.amount + event.fee + event.tax);

  openLot(ctx, {
    accountId: event.accountId,
    instrumentId,
    openTransactionId: event.id,
    openedOn: event.occurredOn,
    quantity,
    costPerUnit: roundPrice(safeDivide(totalCost, quantity)),
    currency: event.currency,
    fxRate: event.fxRate,
    estimated: false,
  });

  adjustCash(ctx, event.accountId, event.currency, -totalCost);
}

// --- SELL / TRANSFER_OUT: consumo FIFO ---
//
// Una venta realiza P&L; una transferencia NO es una enajenación y no realiza
// nada, solo cierra los lotes (y los reabre en la cuenta destino si se conoce).

function applyDisposal(
  ctx: ReplayContext,
  event: LedgerEvent,
  disposition: RealizationDisposition,
): void {
  const quantity = requireQuantity(event);
  const instrumentId = requireInstrument(event);
  const isSale = disposition === RealizationDisposition.SALE;

  const proceedsNet = isSale
    ? roundMoney(event.amount - event.fee - event.tax)
    : 0;
  const proceedsPerUnit = isSale
    ? roundPrice(safeDivide(proceedsNet, quantity))
    : 0;

  const lots = ctx.lots.get(key(event.accountId, instrumentId)) ?? [];
  const available = lots.reduce(
    (sum, lot) => addQuantity(sum, lot.quantityOpen),
    0,
  );
  if (isNegativeQuantity(available - quantity)) {
    throw new LedgerError(
      `No hay cantidad suficiente del instrumento para la operación del ${event.occurredOn}: ` +
        `se intentan ${quantity} y solo hay ${available}`,
    );
  }

  let remaining = quantity;
  // FIFO: los lotes ya están en orden de apertura dentro del array
  for (const lot of lots) {
    if (isZeroQuantity(remaining)) {
      break;
    }
    if (isZeroQuantity(lot.quantityOpen)) {
      continue;
    }
    const taken = roundQuantity(Math.min(lot.quantityOpen, remaining));
    lot.quantityOpen = roundQuantity(lot.quantityOpen - taken);
    remaining = roundQuantity(remaining - taken);
    if (isZeroQuantity(lot.quantityOpen)) {
      lot.closedOn = event.occurredOn;
    }

    const realizedPnl = isSale
      ? roundMoney(taken * (proceedsPerUnit - lot.costPerUnit))
      : 0;

    ctx.realizations.push({
      id: randomUUID(),
      accountId: event.accountId,
      instrumentId,
      sellTransactionId: event.id,
      lotId: lot.id,
      quantity: taken,
      proceedsPerUnit,
      costPerUnit: lot.costPerUnit,
      realizedPnl,
      realizedPnlBase: toBase(realizedPnl, event.fxRate),
      currency: event.currency,
      realizedOn: event.occurredOn,
      disposition,
      costBasisIsEstimated: lot.costBasisIsEstimated,
    });

    if (isSale) {
      accumulateRealized(
        ctx,
        event.accountId,
        instrumentId,
        toBase(realizedPnl, event.fxRate),
      );
    }

    // transferencia con destino conocido: el lote se reabre allí conservando
    // base y fecha de apertura original, que es lo que hace que FIFO siga
    // siendo coherente entre cuentas
    if (!isSale && event.counterpartyAccountId) {
      openLot(ctx, {
        accountId: event.counterpartyAccountId,
        instrumentId,
        openTransactionId: event.id,
        openedOn: lot.openedOn,
        quantity: taken,
        costPerUnit: lot.costPerUnit,
        currency: lot.currency,
        fxRate:
          safeDivide(lot.costPerUnitBase, lot.costPerUnit) || event.fxRate,
        estimated: lot.costBasisIsEstimated,
      });
      touchPosition(
        ctx,
        event.counterpartyAccountId,
        instrumentId,
        event.occurredOn,
      );
    }
  }

  if (isSale) {
    adjustCash(ctx, event.accountId, event.currency, proceedsNet);
  } else {
    registerFlow(ctx, event, -roundMoney(quantity * averageOpenCost(lots)));
  }
}

// --- DIVIDEND / INTEREST: ingreso, nunca P&L de enajenación ---

function applyIncome(ctx: ReplayContext, event: LedgerEvent): void {
  const net = roundMoney(event.amount - event.tax - event.fee);
  adjustCash(ctx, event.accountId, event.currency, net);
  const netBase = toBase(net, event.fxRate);
  if (event.type === InvestmentTransactionType.DIVIDEND) {
    ctx.income.dividendsBase = addMoney(ctx.income.dividendsBase, netBase);
  } else {
    ctx.income.interestBase = addMoney(ctx.income.interestBase, netBase);
  }
  if (event.tax) {
    ctx.income.taxesBase = addMoney(
      ctx.income.taxesBase,
      toBase(event.tax, event.fxRate),
    );
  }
  if (event.fee) {
    ctx.income.feesBase = addMoney(
      ctx.income.feesBase,
      toBase(event.fee, event.fxRate),
    );
  }
}

// --- DEPOSIT / WITHDRAWAL: los únicos flujos externos puros ---

function applyDeposit(ctx: ReplayContext, event: LedgerEvent): void {
  adjustCash(ctx, event.accountId, event.currency, event.amount);
  const base = toBase(event.amount, event.fxRate);
  ctx.contributionsBase = addMoney(ctx.contributionsBase, base);
  registerFlow(ctx, event, base);
}

function applyWithdrawal(ctx: ReplayContext, event: LedgerEvent): void {
  adjustCash(ctx, event.accountId, event.currency, -event.amount);
  const base = toBase(event.amount, event.fxRate);
  ctx.withdrawalsBase = addMoney(ctx.withdrawalsBase, base);
  registerFlow(ctx, event, -base);
}

// --- FEE / TAX sueltos: NUNCA tocan la base de costo ---
//
// Aunque lleven instrumentId (se permite, solo para poder atribuir
// "rendimiento por activo"). Esto es lo que mantiene honesto el retorno neto:
// el TWR y el XIRR los ven como caída de valor, no como flujo externo.

function applyCharge(ctx: ReplayContext, event: LedgerEvent): void {
  adjustCash(ctx, event.accountId, event.currency, -event.amount);
  const base = toBase(event.amount, event.fxRate);
  if (event.type === InvestmentTransactionType.FEE) {
    ctx.income.feesBase = addMoney(ctx.income.feesBase, base);
  } else {
    ctx.income.taxesBase = addMoney(ctx.income.taxesBase, base);
  }
}

// --- SPLIT: multiplica cantidad y divide costo unitario ---
//
// El costo TOTAL del lote queda invariante, que es la propiedad que hace que
// un split no invente ni destruya base. No mueve efectivo: si el bróker pagó
// la fracción sobrante en dinero, eso llega como una fila SELL aparte.

function applySplit(ctx: ReplayContext, event: LedgerEvent): void {
  const instrumentId = requireInstrument(event);
  const numerator = event.splitRatioNumerator ?? 0;
  const denominator = event.splitRatioDenominator ?? 0;
  if (numerator <= 0 || denominator <= 0) {
    throw new LedgerError(
      `El split del ${event.occurredOn} necesita una proporción válida (ej. 2:1)`,
    );
  }
  const factor = numerator / denominator;
  // el split aplica a TODAS las cuentas del usuario que tengan el instrumento,
  // no solo a la cuenta de la fila: es un hecho del mercado, no de la cuenta
  for (const [mapKey, lots] of ctx.lots.entries()) {
    if (!mapKey.endsWith(`|${instrumentId}`)) {
      continue;
    }
    for (const lot of lots) {
      lot.quantityOriginal = roundQuantity(lot.quantityOriginal * factor);
      lot.quantityOpen = roundQuantity(lot.quantityOpen * factor);
      lot.costPerUnit = roundPrice(safeDivide(lot.costPerUnit, factor));
      lot.costPerUnitBase = roundPrice(safeDivide(lot.costPerUnitBase, factor));
    }
  }
}

// --- TRANSFER_IN: escalera de resolución de la base de costo ---

function applyTransferIn(ctx: ReplayContext, event: LedgerEvent): void {
  const quantity = requireQuantity(event);
  const instrumentId = requireInstrument(event);

  // 1) el precio de la fila, si la importación lo trajo -> base exacta
  // 2) el cierre cacheado de ese día -> base estimada
  // 3) sin precio -> lote con costo 0, marcado como estimado y visible en la API
  let costPerUnit = event.price ?? 0;
  let estimated = false;
  if (!costPerUnit && event.marketPriceHint) {
    costPerUnit = event.marketPriceHint;
    estimated = true;
  } else if (!costPerUnit) {
    estimated = true;
  }

  openLot(ctx, {
    accountId: event.accountId,
    instrumentId,
    openTransactionId: event.id,
    openedOn: event.occurredOn,
    quantity,
    costPerUnit: roundPrice(costPerUnit),
    currency: event.currency,
    fxRate: event.fxRate,
    estimated,
  });

  registerFlow(
    ctx,
    event,
    toBase(roundMoney(quantity * costPerUnit), event.fxRate),
  );
}

// --- CURRENCY_EXCHANGE: mueve efectivo entre dos monedas de la misma cuenta ---
//
// La ganancia/pérdida cambiaria NO se registra como P&L realizado: para una
// app de finanzas personales eso es ruido, y el efecto real ya se ve porque
// todo se valora en la moneda base.

function applyCurrencyExchange(ctx: ReplayContext, event: LedgerEvent): void {
  if (!event.settlementCurrency || event.settlementAmount == null) {
    throw new LedgerError(
      `El cambio de divisa del ${event.occurredOn} necesita moneda e importe de liquidación`,
    );
  }
  adjustCash(
    ctx,
    event.accountId,
    event.currency,
    -roundMoney(event.amount + event.fee + event.tax),
  );
  adjustCash(
    ctx,
    event.accountId,
    event.settlementCurrency,
    event.settlementAmount,
  );
}

// --- helpers de estado ---

interface OpenLotArgs {
  accountId: string;
  instrumentId: string;
  openTransactionId: string | null;
  openedOn: string;
  quantity: number;
  costPerUnit: number;
  currency: string;
  fxRate: number;
  estimated: boolean;
}

function openLot(ctx: ReplayContext, args: OpenLotArgs): void {
  const mapKey = key(args.accountId, args.instrumentId);
  const lots = ctx.lots.get(mapKey) ?? [];
  lots.push({
    id: randomUUID(),
    accountId: args.accountId,
    instrumentId: args.instrumentId,
    openTransactionId: args.openTransactionId,
    openedOn: args.openedOn,
    quantityOriginal: args.quantity,
    quantityOpen: args.quantity,
    costPerUnit: args.costPerUnit,
    currency: args.currency,
    costPerUnitBase: roundPrice(args.costPerUnit * args.fxRate),
    costBasisIsEstimated: args.estimated,
    closedOn: null,
    sequence: ctx.sequence++,
  });
  // reordenar por fecha de apertura mantiene el FIFO correcto cuando un lote
  // entra por transferencia con una fecha anterior a la del evento
  lots.sort((a, b) =>
    a.openedOn === b.openedOn
      ? a.sequence - b.sequence
      : a.openedOn < b.openedOn
        ? -1
        : 1,
  );
  ctx.lots.set(mapKey, lots);
}

function adjustCash(
  ctx: ReplayContext,
  accountId: string,
  currency: string,
  delta: number,
): void {
  if (!delta) {
    return;
  }
  const mapKey = cashKey(accountId, currency);
  const current = ctx.cash.get(mapKey) ?? { accountId, currency, amount: 0 };
  current.amount = addMoney(current.amount, delta);
  ctx.cash.set(mapKey, current);
}

function registerFlow(
  ctx: ReplayContext,
  event: LedgerEvent,
  amountBase: number,
): void {
  if (!EXTERNAL_FLOW_TYPES.includes(event.type) || !amountBase) {
    return;
  }
  ctx.flows.push({
    date: event.occurredOn,
    accountId: event.accountId,
    amountBase: roundMoney(amountBase),
  });
}

function touchPosition(
  ctx: ReplayContext,
  accountId: string,
  instrumentId: string,
  occurredOn: string,
): void {
  const mapKey = key(accountId, instrumentId);
  const current = ctx.lastTransactionOn.get(mapKey);
  if (!current || current < occurredOn) {
    ctx.lastTransactionOn.set(mapKey, occurredOn);
  }
}

function accumulateRealized(
  ctx: ReplayContext,
  accountId: string,
  instrumentId: string,
  amountBase: number,
): void {
  const mapKey = key(accountId, instrumentId);
  ctx.realizedByPosition.set(
    mapKey,
    addMoney(ctx.realizedByPosition.get(mapKey) ?? 0, amountBase),
  );
}

function averageOpenCost(lots: LedgerLot[]): number {
  const open = lots.filter((lot) => !isZeroQuantity(lot.quantityOpen));
  const quantity = open.reduce(
    (sum, lot) => addQuantity(sum, lot.quantityOpen),
    0,
  );
  if (isZeroQuantity(quantity)) {
    return 0;
  }
  const basis = open.reduce(
    (sum, lot) => addMoney(sum, lot.quantityOpen * lot.costPerUnit),
    0,
  );
  return roundPrice(safeDivide(basis, quantity));
}

// Las posiciones se derivan de los lotes abiertos que dejó el mismo recorrido
// que produjo las realizaciones. Por eso el P&L realizado y el no realizado no
// pueden discrepar: salen de la misma pasada.
function buildPositions(ctx: ReplayContext): LedgerPosition[] {
  const positions: LedgerPosition[] = [];

  const allKeys = new Set<string>([
    ...ctx.lots.keys(),
    ...ctx.realizedByPosition.keys(),
    ...ctx.lastTransactionOn.keys(),
  ]);

  for (const mapKey of allKeys) {
    const [accountId, instrumentId] = mapKey.split('|');
    const lots = (ctx.lots.get(mapKey) ?? []).filter(
      (lot) => !isZeroQuantity(lot.quantityOpen),
    );

    const quantity = lots.reduce(
      (sum, lot) => addQuantity(sum, lot.quantityOpen),
      0,
    );
    const costBasis = lots.reduce(
      (sum, lot) => addMoney(sum, lot.quantityOpen * lot.costPerUnit),
      0,
    );
    const costBasisBase = lots.reduce(
      (sum, lot) => addMoney(sum, lot.quantityOpen * lot.costPerUnitBase),
      0,
    );

    positions.push({
      accountId,
      instrumentId,
      quantity,
      averageCost: roundPrice(safeDivide(costBasis, quantity)),
      costBasis,
      costBasisBase,
      currency: lots[0]?.currency ?? 'USD',
      realizedPnlToDateBase: ctx.realizedByPosition.get(mapKey) ?? 0,
      costBasisIsEstimated: lots.some((lot) => lot.costBasisIsEstimated),
      lastTransactionOn: ctx.lastTransactionOn.get(mapKey) ?? null,
    });
  }

  return positions;
}

function requireQuantity(event: LedgerEvent): number {
  if (event.quantity == null || event.quantity <= 0) {
    throw new LedgerError(
      `La operación ${event.type} del ${event.occurredOn} necesita una cantidad mayor que 0`,
    );
  }
  return event.quantity;
}

function requireInstrument(event: LedgerEvent): string {
  if (!event.instrumentId) {
    throw new LedgerError(
      `La operación ${event.type} del ${event.occurredOn} necesita un instrumento`,
    );
  }
  return event.instrumentId;
}

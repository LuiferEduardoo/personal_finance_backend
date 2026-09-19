import { registerEnumType } from '@nestjs/graphql';

// Las 13 operaciones que puede registrar una cartera. El efecto de cada una
// sobre el efectivo, la cantidad y la base de costo está implementado en un
// único sitio: src/investments/analytics/portfolio-ledger.ts
export enum InvestmentTransactionType {
  BUY = 'buy',
  SELL = 'sell',
  DIVIDEND = 'dividend',
  INTEREST = 'interest',
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  FEE = 'fee',
  TAX = 'tax',
  SPLIT = 'split',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  CURRENCY_EXCHANGE = 'currency_exchange',
}

registerEnumType(InvestmentTransactionType, {
  name: 'InvestmentTransactionType',
  description: 'Tipo de operación de inversión',
});

// operaciones que exigen instrumento
export const INSTRUMENT_REQUIRED_TYPES: readonly InvestmentTransactionType[] = [
  InvestmentTransactionType.BUY,
  InvestmentTransactionType.SELL,
  InvestmentTransactionType.SPLIT,
  InvestmentTransactionType.TRANSFER_IN,
  InvestmentTransactionType.TRANSFER_OUT,
];

// flujos EXTERNOS: entran y salen de la cartera. Son el denominador del TWR y
// la serie de flujos del XIRR. Dividendos, intereses, comisiones e impuestos
// son INTERNOS y no cuentan aquí a propósito.
export const EXTERNAL_FLOW_TYPES: readonly InvestmentTransactionType[] = [
  InvestmentTransactionType.DEPOSIT,
  InvestmentTransactionType.WITHDRAWAL,
  InvestmentTransactionType.TRANSFER_IN,
  InvestmentTransactionType.TRANSFER_OUT,
];

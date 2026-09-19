import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile, matchScore } from './profile.types';

// Exportación de historial de Binance (Spot Trade History / Transaction History).
export const binanceTradeHistoryProfile: ParserProfile = {
  id: 'binance-trade-history',
  broker: BrokerKind.BINANCE,
  detect: (headers) =>
    Math.max(
      matchScore(headers, ['Date(UTC)', 'Pair', 'Side', 'Price', 'Executed']),
      matchScore(headers, ['UTC_Time', 'Operation', 'Coin', 'Change']),
    ),
  columns: {
    occurredOn: ['Date(UTC)', 'UTC_Time', 'Date'],
    occurredAt: ['Date(UTC)', 'UTC_Time'],
    type: ['Side', 'Operation', 'Type'],
    symbol: ['Pair', 'Coin', 'Market', 'Symbol'],
    quantity: ['Executed', 'Amount', 'Change', 'Quantity'],
    price: ['Price', 'AvgTrading Price'],
    amount: ['Amount', 'Total', 'Quote Amount'],
    fee: ['Fee'],
    currency: ['Fee Coin', 'Quote Coin', 'Currency'],
    externalId: ['OrderId', 'TranId', 'Order ID'],
  },
  typeMap: {
    buy: InvestmentTransactionType.BUY,
    sell: InvestmentTransactionType.SELL,
    deposit: InvestmentTransactionType.DEPOSIT,
    'fiat deposit': InvestmentTransactionType.DEPOSIT,
    withdraw: InvestmentTransactionType.WITHDRAWAL,
    withdrawal: InvestmentTransactionType.WITHDRAWAL,
    'fiat withdraw': InvestmentTransactionType.WITHDRAWAL,
    'transaction related': InvestmentTransactionType.BUY,
    'transaction buy': InvestmentTransactionType.BUY,
    'transaction sold': InvestmentTransactionType.SELL,
    'transaction fee': InvestmentTransactionType.FEE,
    fee: InvestmentTransactionType.FEE,
    'simple earn flexible interest': InvestmentTransactionType.INTEREST,
    'savings interest': InvestmentTransactionType.INTEREST,
    distribution: InvestmentTransactionType.DIVIDEND,
    'small assets exchange bnb': InvestmentTransactionType.CURRENCY_EXCHANGE,
  },
  dateOrder: 'YMD',
};

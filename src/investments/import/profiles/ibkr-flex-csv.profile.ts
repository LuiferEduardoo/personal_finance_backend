import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile, matchScore } from './profile.types';

// Exportación CSV de una Flex Query de Interactive Brokers.
export const ibkrFlexCsvProfile: ParserProfile = {
  id: 'ibkr-flex-csv',
  broker: BrokerKind.INTERACTIVE_BROKERS,
  detect: (headers) =>
    matchScore(headers, [
      'TradeDate',
      'Symbol',
      'Quantity',
      'TradePrice',
      'IBCommission',
    ]),
  columns: {
    occurredOn: ['TradeDate', 'SettleDate', 'Date/Time', 'ReportDate'],
    occurredAt: ['Date/Time', 'DateTime'],
    type: ['Buy/Sell', 'TransactionType', 'Type', 'ActivityCode'],
    symbol: ['Symbol', 'UnderlyingSymbol'],
    isin: ['ISIN'],
    quantity: ['Quantity'],
    price: ['TradePrice', 'Price'],
    amount: ['Proceeds', 'TradeMoney', 'Amount'],
    fee: ['IBCommission', 'Commission'],
    tax: ['Tax', 'Withholding'],
    currency: ['CurrencyPrimary', 'Currency'],
    externalId: ['TransactionID', 'TradeID'],
    notes: ['Description'],
  },
  typeMap: {
    buy: InvestmentTransactionType.BUY,
    bot: InvestmentTransactionType.BUY,
    sell: InvestmentTransactionType.SELL,
    sld: InvestmentTransactionType.SELL,
    div: InvestmentTransactionType.DIVIDEND,
    dividend: InvestmentTransactionType.DIVIDEND,
    'payment in lieu of dividends': InvestmentTransactionType.DIVIDEND,
    int: InvestmentTransactionType.INTEREST,
    'broker interest received': InvestmentTransactionType.INTEREST,
    'broker interest paid': InvestmentTransactionType.FEE,
    'withholding tax': InvestmentTransactionType.TAX,
    'other fees': InvestmentTransactionType.FEE,
    'commission adjustment': InvestmentTransactionType.FEE,
    deposit: InvestmentTransactionType.DEPOSIT,
    'deposits & withdrawals': InvestmentTransactionType.DEPOSIT,
    withdrawal: InvestmentTransactionType.WITHDRAWAL,
  },
  dateOrder: 'YMD',
};

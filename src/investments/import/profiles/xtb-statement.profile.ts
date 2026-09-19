import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile, matchScore } from './profile.types';

// Statement de XTB (xStation "Cash Operations" / "Closed Positions").
// Los statements de XTB suelen venir con coma decimal.
export const xtbStatementProfile: ParserProfile = {
  id: 'xtb-statement',
  broker: BrokerKind.XTB,
  detect: (headers) =>
    Math.max(
      matchScore(headers, [
        'ID',
        'Type',
        'Time',
        'Symbol',
        'Comment',
        'Amount',
      ]),
      matchScore(headers, [
        'Position',
        'Symbol',
        'Volume',
        'Open time',
        'Open price',
      ]),
    ),
  columns: {
    occurredOn: ['Time', 'Open time', 'Close time', 'Fecha'],
    occurredAt: ['Time', 'Open time'],
    type: ['Type', 'Tipo', 'Operation'],
    symbol: ['Symbol', 'Instrument', 'Símbolo'],
    quantity: ['Volume', 'Volumen'],
    price: ['Open price', 'Close price', 'Price'],
    amount: ['Amount', 'Gross P/L', 'Importe'],
    fee: ['Commission', 'Swap', 'Comisión'],
    currency: ['Currency', 'Moneda'],
    externalId: ['ID', 'Position', 'Order'],
    notes: ['Comment', 'Comentario'],
  },
  typeMap: {
    buy: InvestmentTransactionType.BUY,
    'stocks purchase': InvestmentTransactionType.BUY,
    sell: InvestmentTransactionType.SELL,
    'stocks sale': InvestmentTransactionType.SELL,
    deposit: InvestmentTransactionType.DEPOSIT,
    withdrawal: InvestmentTransactionType.WITHDRAWAL,
    dividend: InvestmentTransactionType.DIVIDEND,
    'dividend payment': InvestmentTransactionType.DIVIDEND,
    'withholding tax': InvestmentTransactionType.TAX,
    commission: InvestmentTransactionType.FEE,
    swap: InvestmentTransactionType.FEE,
    'free funds interests': InvestmentTransactionType.INTEREST,
  },
  dateOrder: 'DMY',
  decimalSeparator: ',',
};

import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile, matchScore } from './profile.types';

// Hoja "Account Activity" del statement de eToro.
export const etoroStatementProfile: ParserProfile = {
  id: 'etoro-statement',
  broker: BrokerKind.ETORO,
  detect: (headers) =>
    matchScore(headers, ['Date', 'Type', 'Details', 'Amount', 'Position ID']),
  columns: {
    occurredOn: ['Date', 'Fecha'],
    type: ['Type', 'Tipo'],
    symbol: ['Details', 'Asset', 'Símbolo'],
    amount: ['Amount', 'Importe'],
    quantity: ['Units', 'Unidades'],
    price: ['Open Rate', 'Rate', 'Precio'],
    fee: ['Fees', 'Comisión'],
    externalId: ['Position ID', 'Transaction ID'],
    notes: ['Details'],
  },
  typeMap: {
    open: InvestmentTransactionType.BUY,
    'open position': InvestmentTransactionType.BUY,
    buy: InvestmentTransactionType.BUY,
    close: InvestmentTransactionType.SELL,
    'position closed': InvestmentTransactionType.SELL,
    sell: InvestmentTransactionType.SELL,
    deposit: InvestmentTransactionType.DEPOSIT,
    withdraw: InvestmentTransactionType.WITHDRAWAL,
    withdrawal: InvestmentTransactionType.WITHDRAWAL,
    'withdraw request': InvestmentTransactionType.WITHDRAWAL,
    dividend: InvestmentTransactionType.DIVIDEND,
    interest: InvestmentTransactionType.INTEREST,
    'interest payment': InvestmentTransactionType.INTEREST,
    fee: InvestmentTransactionType.FEE,
    'rollover fee': InvestmentTransactionType.FEE,
    'withdrawal fee': InvestmentTransactionType.FEE,
    'stock split': InvestmentTransactionType.SPLIT,
  },
  dateOrder: 'DMY',
};

import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile } from './profile.types';

// Último recurso: acepta los nombres de columna más habituales, en inglés y en
// español. Su confianza es siempre 0 para que cualquier perfil específico gane;
// existe para que un bróker desconocido no sea un callejón sin salida, no para
// acertar solo.
export const genericProfile: ParserProfile = {
  id: 'generic',
  broker: BrokerKind.MANUAL,
  detect: () => 0,
  columns: {
    occurredOn: ['date', 'fecha', 'trade date', 'fecha operacion', 'time'],
    occurredAt: ['datetime', 'time', 'hora'],
    type: ['type', 'tipo', 'operation', 'operacion', 'side', 'action'],
    symbol: ['symbol', 'simbolo', 'ticker', 'asset', 'activo', 'instrument'],
    isin: ['isin'],
    quantity: ['quantity', 'cantidad', 'units', 'unidades', 'shares', 'volume'],
    price: ['price', 'precio', 'unit price', 'precio unitario'],
    amount: ['amount', 'importe', 'total', 'monto', 'value'],
    fee: ['fee', 'fees', 'comision', 'commission'],
    tax: ['tax', 'impuesto', 'withholding'],
    currency: ['currency', 'moneda', 'divisa'],
    externalId: ['id', 'transaction id', 'order id', 'reference'],
    notes: ['notes', 'notas', 'description', 'descripcion', 'comment'],
  },
  typeMap: {
    buy: InvestmentTransactionType.BUY,
    compra: InvestmentTransactionType.BUY,
    sell: InvestmentTransactionType.SELL,
    venta: InvestmentTransactionType.SELL,
    dividend: InvestmentTransactionType.DIVIDEND,
    dividendo: InvestmentTransactionType.DIVIDEND,
    interest: InvestmentTransactionType.INTEREST,
    interes: InvestmentTransactionType.INTEREST,
    deposit: InvestmentTransactionType.DEPOSIT,
    deposito: InvestmentTransactionType.DEPOSIT,
    ingreso: InvestmentTransactionType.DEPOSIT,
    withdrawal: InvestmentTransactionType.WITHDRAWAL,
    retiro: InvestmentTransactionType.WITHDRAWAL,
    fee: InvestmentTransactionType.FEE,
    comision: InvestmentTransactionType.FEE,
    tax: InvestmentTransactionType.TAX,
    impuesto: InvestmentTransactionType.TAX,
    split: InvestmentTransactionType.SPLIT,
    transfer_in: InvestmentTransactionType.TRANSFER_IN,
    transfer_out: InvestmentTransactionType.TRANSFER_OUT,
    'currency exchange': InvestmentTransactionType.CURRENCY_EXCHANGE,
  },
};

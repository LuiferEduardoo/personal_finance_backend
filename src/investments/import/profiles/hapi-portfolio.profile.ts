import { BrokerKind } from '../../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../../common/enums/investment-transaction-type.enum';
import { ParserProfile, matchScore } from './profile.types';

// Plantilla personal de operaciones de Hapi. "Estado" contiene Compra/Venta,
// mientras que "Tipo de Inversión" describe el instrumento (Acciones, ETF,
// etc.) y por eso no debe mapearse como tipo de operación.
export const hapiPortfolioProfile: ParserProfile = {
  id: 'hapi-portfolio-es',
  broker: BrokerKind.MANUAL,
  detect: (headers) =>
    matchScore(headers, [
      'Fecha',
      'Broker',
      'Estado',
      'Tipo de Inversión',
      'Activo',
      'Cantidad',
      'Precio Acción',
      'Importe',
      'Comisión',
      'Importe total',
    ]),
  columns: {
    occurredOn: ['Fecha'],
    type: ['Estado'],
    symbol: ['Activo'],
    quantity: ['Cantidad'],
    price: ['Precio Acción'],
    // Importe es el bruto; Importe total ya incorpora la comisión.
    amount: ['Importe'],
    fee: ['Comisión'],
    notes: ['Sector'],
  },
  typeMap: {
    compra: InvestmentTransactionType.BUY,
    buy: InvestmentTransactionType.BUY,
    venta: InvestmentTransactionType.SELL,
    sell: InvestmentTransactionType.SELL,
    dividendo: InvestmentTransactionType.DIVIDEND,
    dividend: InvestmentTransactionType.DIVIDEND,
  },
  dateOrder: 'DMY',
  decimalSeparator: '.',
};

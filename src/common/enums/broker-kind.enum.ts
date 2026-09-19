import { registerEnumType } from '@nestjs/graphql';

// Bróker o exchange del que procede una cuenta de inversión. MANUAL es para
// las cuentas que el usuario lleva a mano, sin conexión automática.
export enum BrokerKind {
  ETORO = 'etoro',
  INTERACTIVE_BROKERS = 'interactive_brokers',
  BINANCE = 'binance',
  XTB = 'xtb',
  MANUAL = 'manual',
}

registerEnumType(BrokerKind, {
  name: 'BrokerKind',
  description: 'Bróker o exchange de una cuenta de inversión',
});

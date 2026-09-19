import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { ProfileRegistry } from './profile-registry';

// Cabeceras reales (o muy cercanas) de cada exportación.
const HEADERS = {
  etoro: ['Date', 'Type', 'Details', 'Amount', 'Units', 'Position ID'],
  ibkr: [
    'TradeDate',
    'Symbol',
    'Quantity',
    'TradePrice',
    'IBCommission',
    'CurrencyPrimary',
    'TransactionID',
  ],
  binance: ['Date(UTC)', 'Pair', 'Side', 'Price', 'Executed', 'Amount', 'Fee'],
  xtb: ['ID', 'Type', 'Time', 'Symbol', 'Comment', 'Amount'],
};

describe('ProfileRegistry: detección', () => {
  const registry = new ProfileRegistry();

  it('reconoce un statement de eToro', () => {
    const d = registry.detect(HEADERS.etoro);
    expect(d.profile.id).toBe('etoro-statement');
    expect(d.profile.broker).toBe(BrokerKind.ETORO);
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('reconoce un Flex CSV de Interactive Brokers', () => {
    const d = registry.detect(HEADERS.ibkr);
    expect(d.profile.id).toBe('ibkr-flex-csv');
    expect(d.profile.broker).toBe(BrokerKind.INTERACTIVE_BROKERS);
  });

  it('reconoce un historial de Binance', () => {
    const d = registry.detect(HEADERS.binance);
    expect(d.profile.id).toBe('binance-trade-history');
  });

  it('reconoce un statement de XTB', () => {
    const d = registry.detect(HEADERS.xtb);
    expect(d.profile.id).toBe('xtb-statement');
  });

  it('cae al genérico con cabeceras desconocidas', () => {
    const d = registry.detect(['foo', 'bar', 'baz']);
    expect(d.profile.id).toBe('generic');
    expect(d.confidence).toBe(0);
  });

  it('un bróker desconocido con nombres habituales NO es un callejón sin salida', () => {
    const d = registry.detect([
      'Fecha',
      'Tipo',
      'Símbolo',
      'Cantidad',
      'Precio',
    ]);
    expect(d.profile.id).toBe('generic');
    expect(d.mapping).toMatchObject({
      occurredOn: 'Fecha',
      type: 'Tipo',
      symbol: 'Símbolo',
      quantity: 'Cantidad',
      price: 'Precio',
    });
  });
});

describe('ProfileRegistry: mapeo de columnas', () => {
  const registry = new ProfileRegistry();

  it('mapea a la cabecera REAL del archivo, no al alias', () => {
    const d = registry.detect(HEADERS.ibkr);
    expect(d.mapping.occurredOn).toBe('TradeDate');
    expect(d.mapping.fee).toBe('IBCommission');
    expect(d.mapping.currency).toBe('CurrencyPrimary');
  });

  it('ignora acentos, mayúsculas y separadores al comparar', () => {
    const d = registry.detect(['FECHA', 'tipo', 'simbolo', 'cantidad']);
    expect(d.mapping.occurredOn).toBe('FECHA');
    expect(d.mapping.symbol).toBe('simbolo');
  });

  it('no inventa un mapeo para columnas que no están', () => {
    const d = registry.detect(['Fecha', 'Tipo']);
    expect(d.mapping.quantity).toBeUndefined();
    expect(d.mapping.price).toBeUndefined();
  });
});

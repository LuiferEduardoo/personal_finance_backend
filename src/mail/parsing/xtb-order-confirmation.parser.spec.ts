import {
  XtbOrderConfirmationError,
  parseXtbNumber,
  parseXtbOrderConfirmation,
} from './xtb-order-confirmation.parser';

// Todos los datos personales y los ids de orden son inventados.
const HEADER = `Confirmación de órdenes ejecutadas en 27/5/2026
Nombre y Apellidos Cuenta Divisa de la cuenta Patrimonio
Ana Ejemplo 1234567 USD 1,00 1.776,76 1.775,76 0,00 1,00`;
const COLUMNS = `Nº Iden ficación de
orden
Ticker del ac vo
Sistema de
ejecución de
órdenes
Precio de la co zación`;
const FOOTER = `XTB INTERNATIONAL LIMITED (FSC)
Calle Falsa 123, Belize City, Belize, C.A. 1/2`;

const SELL_ROW = `1 9000000001 CSPX.UK iShares, UCITS,
ACC, USD
XTB 0,0810 27/5/2026
9:00:45
market 809,27000 65,55087 ETFs USD 1.0000 0,00 0,00 0,00`;

const document = (...parts: string[]) => parts.join('\n');

describe('parseXtbOrderConfirmation', () => {
  it('lee una venta con el nombre partido en varias líneas', () => {
    const [order, ...rest] = parseXtbOrderConfirmation(
      document(
        HEADER,
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        COLUMNS,
        SELL_ROW,
        FOOTER,
      ),
    );

    expect(rest).toHaveLength(0);
    expect(order).toEqual({
      side: 'SELL',
      orderId: '9000000001',
      ticker: 'CSPX.UK',
      instrumentName: 'iShares, UCITS, ACC, USD',
      executionSystem: 'XTB',
      volume: 0.081,
      occurredOn: '2026-05-27',
      time: '09:00:45',
      orderType: 'market',
      price: 809.27,
      total: 65.55087,
      assetType: 'ETFs',
      quoteCurrency: 'USD',
      fxRate: 1,
      fxCommission: 0,
      commission: 0,
    });
  });

  it('no extrae el nombre ni la cuenta del titular', () => {
    const [order] = parseXtbOrderConfirmation(
      document(
        HEADER,
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW,
      ),
    );
    expect(JSON.stringify(order)).not.toMatch(/Ana|Ejemplo|1234567/);
  });

  it('mezcla secciones de compra y venta en varias páginas, en orden', () => {
    const orders = parseXtbOrderConfirmation(
      document(
        HEADER,
        'Órdenes de compra de Acciones Fraccionadas ejecutadas (2)',
        COLUMNS,
        `1 9000000002 PG.US Procter &
Gamble Co XTB 0.0438 10.06.2025
18:25:40
market 110.05000 4.82019 Cash Stocks USD 1.0000 0.00 0.00 0.00`,
        FOOTER,
        // página de continuación: sin el título del documento
        COLUMNS,
        `2 9000000003 META.US Meta Platforms Inc - class A
KNEM 0.0100 10.06.2025
18:25:41
market 700.00000 7.00000 Cash Stocks USD 1.0000 0.00 0.00 0.00`,
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW,
        'Órdenes de compra ejecutadas en intrumentos OMI (Acciones y ETFs) (1)',
        `1 9000000004 NVO.US Novo Nordisk A/S -
ADR
XTB 1,0000 27/5/2026
9:00:46
market 48,69 48,69 Cash Stocks USD 1.0000 0,00 0,00 0,00`,
        FOOTER,
      ),
    );

    expect(orders.map((o) => [o.side, o.ticker])).toEqual([
      ['BUY', 'PG.US'],
      ['BUY', 'META.US'],
      ['SELL', 'CSPX.UK'],
      ['BUY', 'NVO.US'],
    ]);
    expect(orders[0]).toMatchObject({
      instrumentName: 'Procter & Gamble Co',
      volume: 0.0438,
      occurredOn: '2025-06-10',
      time: '18:25:40',
    });
    expect(orders[1]).toMatchObject({
      instrumentName: 'Meta Platforms Inc - class A',
      executionSystem: 'KNEM',
    });
    expect(orders[3].instrumentName).toBe('Novo Nordisk A/S - ADR');
  });

  it('tolera tipos de orden y de activo no vistos', () => {
    const [order] = parseXtbOrderConfirmation(
      document(
        'Órdenes de compra de algo nuevo (1)',
        `1 9000000005 BRKB.US Berkshire Hathaway XTB 2,0000 1/2/2026 10:00:00
stop limit 100,00 200,00 Otros Activos USD 1.0000 0,00 0,00 0,00`,
      ),
    );
    expect(order).toMatchObject({
      ticker: 'BRKB.US',
      orderType: 'stop limit',
      assetType: 'Otros Activos',
    });
  });

  it('mantiene las comisiones que cuadran con el coste total', () => {
    const [order] = parseXtbOrderConfirmation(
      document(
        'Órdenes de compra de Acciones Fraccionadas ejecutadas (1)',
        `1 9000000006 PG.US Procter XTB 1,0000 1/2/2026 10:00:00
market 100,00 100,00 Cash Stocks USD 1.0000 0,10 1,25 1,35`,
      ),
    );
    expect(order).toMatchObject({ fxCommission: 0.1, commission: 1.25 });
  });

  describe('rechaza el documento entero', () => {
    const reject = (...parts: string[]) =>
      expect(() => parseXtbOrderConfirmation(document(...parts)));

    it('si la sección trae menos filas de las que anuncia', () => {
      reject(
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (2)',
        SELL_ROW,
      ).toThrow(XtbOrderConfirmationError);
    });

    it('si la sección trae más filas de las que anuncia', () => {
      reject(
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW,
        SELL_ROW.replace('9000000001', '9000000009').replace(/^1 /, '2 '),
      ).toThrow('anuncia 1 órdenes y se leyeron 2');
    });

    it('si el total no cuadra con volumen x precio', () => {
      reject(
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW.replace('65,55087', '70,00000'),
      ).toThrow('no cuadra');
    });

    it('si el coste total no cuadra con las comisiones', () => {
      reject(
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW.replace('0,00 0,00 0,00', '0,00 0,00 3,00'),
      ).toThrow('coste total');
    });

    it('si una fila no se puede leer, sin repetir su contenido', () => {
      const parse = () =>
        parseXtbOrderConfirmation(
          document(
            'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
            '1 9000000001 CSPX.UK iShares sin columnas',
            FOOTER,
          ),
        );
      expect(parse).toThrow('No se pudo leer la fila de la orden 9000000001');
      expect(parse).not.toThrow('iShares');
    });

    it('si la fecha no existe', () => {
      reject(
        'Órdenes de venta de Acciones Fraccionadas ejecutadas (1)',
        SELL_ROW.replace('27/5/2026', '31/2/2026'),
      ).toThrow('fecha');
    });

    it('si hay una fila fuera de toda sección', () => {
      reject(HEADER, SELL_ROW).toThrow('fuera de una sección');
    });

    it('si dice ser una confirmación y no trae secciones', () => {
      reject(HEADER, FOOTER).toThrow('ninguna sección');
    });
  });

  it('un PDF de otra cosa no es un error: no trae órdenes', () => {
    expect(
      parseXtbOrderConfirmation('Extracto mensual de la cuenta\nNada más'),
    ).toEqual([]);
  });
});

describe('parseXtbNumber', () => {
  it.each([
    ['0,0810', 0.081],
    ['0.0438', 0.0438],
    ['809,27000', 809.27],
    ['110.05000', 110.05],
    ['1.776,76', 1776.76],
    ['1,776.76', 1776.76],
    ['1.234.567', 1234567],
    ['48', 48],
    ['-1,25', -1.25],
  ])('%s -> %d', (raw, expected) => {
    expect(parseXtbNumber(raw)).toBeCloseTo(expected, 8);
  });
});

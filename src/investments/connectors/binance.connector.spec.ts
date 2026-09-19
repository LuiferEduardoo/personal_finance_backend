import {
  DEFAULT_QUOTES,
  MAX_CANDIDATE_PAIRS,
  buildCandidatePairs,
  resolveQuoteAsset,
} from './binance.connector';

// Pares que Binance reconoce, recortados a lo que hace falta para las pruebas.
const VALID = new Set([
  'BTCUSDT',
  'BTCFDUSD',
  'BTCUSDC',
  'BTCEUR',
  'ETHUSDT',
  'ETHBTC',
  'SOLUSDT',
  'BNBUSDT',
]);

describe('buildCandidatePairs: qué pares se consultan', () => {
  it('arma los pares desde los activos con saldo', () => {
    const pairs = buildCandidatePairs({
      assets: ['BTC'],
      previousPairs: [],
      quotes: DEFAULT_QUOTES,
      validSymbols: VALID,
    });
    expect(pairs).toEqual(
      expect.arrayContaining(['BTCUSDT', 'BTCFDUSD', 'BTCUSDC', 'BTCEUR']),
    );
  });

  it('descarta pares que Binance no reconoce', () => {
    const pairs = buildCandidatePairs({
      assets: ['BTC'],
      previousPairs: [],
      quotes: ['USDT', 'INVENTADA'],
      validSymbols: VALID,
    });
    expect(pairs).toEqual(['BTCUSDT']);
  });

  it('no cruza un activo consigo mismo', () => {
    const pairs = buildCandidatePairs({
      assets: ['BTC'],
      previousPairs: [],
      quotes: ['BTC', 'USDT'],
      validSymbols: VALID,
    });
    expect(pairs).not.toContain('BTCBTC');
  });

  // ESTE es el fallo que dejaba sin traer las operaciones de bitcoin.
  it('SIGUE consultando un par de un activo ya vendido del todo', () => {
    const pairs = buildCandidatePairs({
      // el usuario vendió todo su BTC: ya no tiene saldo
      assets: ['USDT'],
      // pero sincronizaciones anteriores sí lo vieron
      previousPairs: ['BTCUSDT'],
      quotes: DEFAULT_QUOTES,
      validSymbols: VALID,
    });
    expect(pairs).toContain('BTCUSDT');
  });

  it('incluye los activos que el usuario ya operó aunque no tenga saldo', () => {
    // así es como el servicio de sincronización inyecta el libro: el activo
    // entra en `assets` aunque el saldo sea cero
    const pairs = buildCandidatePairs({
      assets: ['BTC', 'ETH'],
      previousPairs: [],
      quotes: ['USDT'],
      validSymbols: VALID,
    });
    expect(pairs).toEqual(expect.arrayContaining(['BTCUSDT', 'ETHUSDT']));
  });

  it('no repite un par que llega por dos vías', () => {
    const pairs = buildCandidatePairs({
      assets: ['BTC'],
      previousPairs: ['BTCUSDT'],
      quotes: ['USDT'],
      validSymbols: VALID,
    });
    expect(pairs.filter((p) => p === 'BTCUSDT')).toHaveLength(1);
  });

  it('sin activos ni histórico no devuelve nada', () => {
    expect(
      buildCandidatePairs({
        assets: [],
        previousPairs: [],
        quotes: DEFAULT_QUOTES,
        validSymbols: VALID,
      }),
    ).toEqual([]);
  });
});

describe('resolveQuoteAsset: en qué moneda se registra la operación', () => {
  it('resuelve los pares habituales', () => {
    expect(resolveQuoteAsset('BTCUSDT', DEFAULT_QUOTES)).toBe('USDT');
    expect(resolveQuoteAsset('ETHBTC', DEFAULT_QUOTES)).toBe('BTC');
    expect(resolveQuoteAsset('BTCEUR', DEFAULT_QUOTES)).toBe('EUR');
  });

  it('elige el sufijo MÁS LARGO', () => {
    // con orden ingenuo, "BTCUSDC" podía casar con un sufijo más corto y
    // quedar registrado en la moneda equivocada
    expect(resolveQuoteAsset('BTCUSDC', DEFAULT_QUOTES)).toBe('USDC');
    expect(resolveQuoteAsset('BTCFDUSD', DEFAULT_QUOTES)).toBe('FDUSD');
    expect(resolveQuoteAsset('BTCBUSD', DEFAULT_QUOTES)).toBe('BUSD');
  });

  it('cae a USDT cuando no reconoce el sufijo', () => {
    expect(resolveQuoteAsset('BTCXYZ', DEFAULT_QUOTES)).toBe('USDT');
  });
});

describe('DEFAULT_QUOTES: cobertura de monedas', () => {
  it('incluye las monedas con las que hoy se compra bitcoin en Binance', () => {
    // FDUSD y USDC faltaban, y son justo donde están muchas compras de BTC
    // por los pares sin comisión que Binance promocionó
    for (const quote of ['USDT', 'FDUSD', 'USDC', 'EUR', 'BTC']) {
      expect(DEFAULT_QUOTES).toContain(quote);
    }
  });

  it('conserva BUSD para el histórico antiguo', () => {
    expect(DEFAULT_QUOTES).toContain('BUSD');
  });
});

describe('buildCandidatePairs: tope de llamadas', () => {
  it('acota cuántos pares se consultan por sincronización', () => {
    const activos = Array.from({ length: 60 }, (_, i) => `COIN${i}`);
    const cotizaciones = ['USDT', 'BTC', 'EUR'];
    const validos = new Set(
      activos.flatMap((a) => cotizaciones.map((q) => `${a}${q}`)),
    );

    const pairs = buildCandidatePairs({
      assets: activos,
      previousPairs: [],
      quotes: cotizaciones,
      validSymbols: validos,
    });

    // 60 x 3 = 180 posibles, pero cada /myTrades pesa 10 en la cuota
    expect(pairs.length).toBe(MAX_CANDIDATE_PAIRS);
  });

  it('los pares ya vistos entran ANTES del tope', () => {
    const activos = Array.from({ length: 200 }, (_, i) => `COIN${i}`);
    const validos = new Set([...activos.map((a) => `${a}USDT`), 'BTCUSDT']);

    const pairs = buildCandidatePairs({
      assets: activos,
      previousPairs: ['BTCUSDT'],
      quotes: ['USDT'],
      validSymbols: validos,
    });

    // el histórico conocido no puede quedar fuera por culpa del tope
    expect(pairs).toContain('BTCUSDT');
  });
});

import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
import { TokenBucket } from '../../common/rate-limit/token-bucket';
import { toDateString } from '../../common/date';
import {
  AccountRef,
  BrokerConnector,
  BrokerCredentials,
  BrokerIdentity,
  FetchResult,
  RawAccount,
  RawPosition,
  RawTransaction,
  SyncCursor,
} from './broker-connector.interface';

const BASE_URL = 'https://api.binance.com';
const TIMEOUT_MS = 15_000;
// Binance rechaza con -1021 si el timestamp queda fuera de esta ventana. Se
// sube al máximo que admite (60 s) porque una cadena larga de llamadas con
// espera entre ellas arrastra deriva.
const RECV_WINDOW = 60_000;
// reintentos ante 429 y ante deriva de reloj
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2_000;

// Binance cuenta "peso" por endpoint; 1200/minuto es el tope de la cuenta.
// Se deja margen porque /myTrades pesa más que una consulta simple.
const WEIGHT_LIMIT = 400;
const WEIGHT_WINDOW_MS = 60_000;

// Ventanas MÁXIMAS que impone Binance por llamada. Pedir un rango más ancho
// devuelve vacío EN SILENCIO, sin error: así es como se perdían las compras
// hechas por Convert, porque una consulta "de toda la vida" no devuelve nada.
const CONVERT_WINDOW_DAYS = 30;
const FIAT_WINDOW_DAYS = 90;
// cuánto histórico recorrer cuando todavía no hay cursor
const DEFAULT_LOOKBACK_DAYS = 730;
// Las órdenes fiat se recorren menos atrás: son DOS llamadas por tramo (compra
// y venta) y el endpoint tiene un tope propio más estrecho.
const FIAT_LOOKBACK_DAYS = 365;
// tope de tramos por sincronización, para no agotar la cuota de peso
const MAX_WINDOWS = 40;

// Monedas de cotización por defecto contra las que buscar pares. El usuario
// puede cambiarlas con "pairs" en las credenciales.
//
// Ordenadas de más larga a más corta a propósito: quoteAsset() resuelve por
// sufijo, y sin ese orden "BTCUSDC" podría casar con "USD" antes que con
// "USDC" y quedar registrado en la moneda equivocada.
//
// FDUSD y USDC son imprescindibles: Binance empujó con fuerza los pares sin
// comisión contra FDUSD, así que muchas compras de BTC están ahí. BUSD sigue
// en la lista aunque esté descontinuado, porque el histórico antiguo lo usa.
const DEFAULT_QUOTES = [
  'FDUSD',
  'USDT',
  'USDC',
  'BUSD',
  'TUSD',
  'DAI',
  'EUR',
  'TRY',
  'BRL',
  'BTC',
  'ETH',
  'BNB',
];

interface BinanceCursor extends SyncCursor {
  /** último tradeId visto por símbolo */
  fromId?: Record<string, number>;
  lastSyncedAt?: number;
  /**
   * Desde cuándo se ha recorrido YA cada fuente, en milisegundos.
   *
   * Es por fuente y no global a propósito: si solo se guardara "última
   * sincronización", añadir una fuente nueva (como Convert) la dejaría atada a
   * esa fecha y su histórico no se recuperaría nunca. Una fuente sin marca
   * aquí se recorre entera.
   */
  coveredFrom?: Record<string, number>;
}

// Monedas que se tratan como "dinero" y no como activo: si una conversión va
// de una de estas a una cripto, es una COMPRA de esa cripto, no dos
// operaciones.
const CASH_ASSETS = new Set([
  'COP',
  'USD',
  'EUR',
  'GBP',
  'BRL',
  'MXN',
  'ARS',
  'PEN',
  'CLP',
  'TRY',
  'USDT',
  'USDC',
  'FDUSD',
  'BUSD',
  'TUSD',
  'DAI',
]);

@Injectable()
export class BinanceConnector implements BrokerConnector {
  readonly broker = BrokerKind.BINANCE;
  private readonly logger = new Logger(BinanceConnector.name);
  private readonly bucket = new TokenBucket(WEIGHT_LIMIT, WEIGHT_WINDOW_MS);

  async verifyCredentials(creds: BrokerCredentials): Promise<BrokerIdentity> {
    const account = await this.signed<{
      accountType?: string;
      canTrade?: boolean;
      balances?: { asset: string; free: string; locked: string }[];
    }>(creds, '/api/v3/account', {});
    return {
      accountId: null,
      displayName: account.accountType ?? 'Binance Spot',
      currency: null,
    };
  }

  async fetchAccounts(creds: BrokerCredentials): Promise<RawAccount[]> {
    await this.verifyCredentials(creds);
    // Binance no expone subcuentas en la API spot: es una sola
    return [{ externalId: 'spot', name: 'Binance Spot', currency: 'USDT' }];
  }

  // La API spot de Binance no distingue subcuentas, así que el AccountRef no
  // se usa aquí; la firma la fija la interfaz común de conectores.
  async fetchPositions(
    creds: BrokerCredentials,
    account: AccountRef,
  ): Promise<RawPosition[]> {
    void account;
    const snapshot = await this.signed<{
      balances: { asset: string; free: string; locked: string }[];
    }>(creds, '/api/v3/account', {});
    return (snapshot.balances ?? [])
      .map((balance) => ({
        symbolHint: balance.asset,
        quantity: Number(balance.free) + Number(balance.locked),
        currency: null,
      }))
      .filter((position) => position.quantity > 0);
  }

  // EL problema de Binance: /api/v3/myTrades EXIGE un símbolo y no existe
  // ningún endpoint que devuelva todas las operaciones de todos los pares.
  //
  // Se construye el conjunto de candidatos: (activos con saldo) x (monedas de
  // cotización), intersecado con los pares que Binance reconoce. Con los
  // valores por defecto son unas decenas de llamadas, dentro del peso.
  async fetchTransactions(
    creds: BrokerCredentials,
    account: AccountRef,
    cursor: SyncCursor | null,
  ): Promise<FetchResult> {
    const previous = (cursor ?? {}) as BinanceCursor;
    const fromId: Record<string, number> = { ...(previous.fromId ?? {}) };
    const warnings: string[] = [];
    const rows: RawTransaction[] = [];

    const symbols = await this.candidateSymbols(
      creds,
      account.knownSymbols ?? [],
      Object.keys(previous.fromId ?? {}),
    );
    if (symbols.length === 0) {
      warnings.push(
        'No se encontró ningún par que consultar. Si operas contra una moneda ' +
          'poco habitual, añádela en "pairs" dentro de las credenciales.',
      );
    }
    if (symbols.length >= MAX_CANDIDATE_PAIRS) {
      warnings.push(
        `Se alcanzó el tope de ${MAX_CANDIDATE_PAIRS} pares por sincronización. ` +
          'Limita "pairs" en las credenciales a las monedas con las que operas ' +
          'de verdad para no dejar operaciones fuera.',
      );
    }

    for (const symbol of symbols) {
      try {
        const trades = await this.signed<
          {
            id: number;
            orderId: number;
            price: string;
            qty: string;
            quoteQty: string;
            commission: string;
            commissionAsset: string;
            time: number;
            isBuyer: boolean;
          }[]
        >(creds, '/api/v3/myTrades', {
          symbol,
          limit: '1000',
          ...(fromId[symbol] ? { fromId: String(fromId[symbol] + 1) } : {}),
        });

        for (const trade of trades) {
          rows.push(this.toTrade(symbol, trade));
          fromId[symbol] = Math.max(fromId[symbol] ?? 0, trade.id);
        }
      } catch (error) {
        // un par que falla no debe abortar los demás
        warnings.push(`${symbol}: ${(error as Error).message}`);
      }
    }

    rows.push(...(await this.fetchCashMovements(creds, warnings)));
    // Convert y las órdenes fiat NO aparecen en /api/v3/myTrades. Muchas
    // compras pequeñas de cripto se hacen por ahí, así que sin esto la
    // sincronización devuelve cero aunque haya saldo.
    rows.push(...(await this.fetchConvertTrades(creds, previous, warnings)));
    rows.push(...(await this.fetchFiatOrders(creds, previous, warnings)));

    const ahora = Date.now();
    return {
      rows,
      cursor: {
        fromId,
        lastSyncedAt: ahora,
        coveredFrom: {
          ...(previous.coveredFrom ?? {}),
          // se conserva la marca más ANTIGUA cubierta: así no se pierde
          // histórico ya recorrido
          convert: Math.min(
            previous.coveredFrom?.convert ?? ahora,
            this.since(previous, 'convert'),
          ),
          fiat: Math.min(
            previous.coveredFrom?.fiat ?? ahora,
            this.since(previous, 'fiat'),
          ),
        },
      } satisfies BinanceCursor,
      partial: warnings.length > 0,
      warnings,
    };
  }

  // Construye el conjunto de pares a consultar.
  //
  // NO basta con el saldo actual: si vendiste todo tu BTC, su saldo es cero y
  // el par BTCUSDT nunca entraría, así que tu histórico no se traería jamás.
  // Por eso se unen tres fuentes: lo que tienes ahora, lo que YA has operado
  // según tu libro, y los pares que sincronizaciones anteriores dejaron en el
  // cursor.
  private async candidateSymbols(
    creds: BrokerCredentials,
    knownSymbols: string[] = [],
    previousPairs: string[] = [],
  ): Promise<string[]> {
    const quotes = creds.get<string[]>('pairs') ?? DEFAULT_QUOTES;
    const account = await this.signed<{
      balances: { asset: string; free: string; locked: string }[];
    }>(creds, '/api/v3/account', {});

    const assets = new Set<string>(
      (account.balances ?? [])
        .filter((balance) => Number(balance.free) + Number(balance.locked) > 0)
        .map((balance) => balance.asset),
    );
    // los símbolos del libro llegan como "BTC/USD" o "BTC": se toma la base
    for (const known of knownSymbols) {
      const base = known.split(/[/:]/)[0].trim().toUpperCase();
      if (base) {
        assets.add(base);
      }
    }

    const valid = await this.exchangeSymbols();
    return buildCandidatePairs({
      assets,
      previousPairs,
      quotes,
      validSymbols: valid,
    });
  }

  private async exchangeSymbols(): Promise<Set<string>> {
    const info = await this.publicGet<{ symbols: { symbol: string }[] }>(
      '/api/v3/exchangeInfo',
      {},
      10,
    );
    return new Set((info.symbols ?? []).map((entry) => entry.symbol));
  }

  // Recorre un rango largo en tramos, porque Binance acota la ventana por
  // llamada y un rango mayor devuelve vacío SIN error.
  private windows(
    since: number,
    windowDays: number,
  ): { start: number; end: number }[] {
    const day = 86_400_000;
    const now = Date.now();
    const tramos: { start: number; end: number }[] = [];
    for (
      let start = since;
      start < now && tramos.length < MAX_WINDOWS;
      start += windowDays * day
    ) {
      tramos.push({ start, end: Math.min(start + windowDays * day, now) });
    }
    return tramos;
  }

  // Desde cuándo pedir una fuente concreta.
  //
  // Si esa fuente ya se recorrió antes, basta con retroceder una semana sobre
  // lo cubierto (el solape lo absorbe la deduplicación). Si NUNCA se recorrió
  // —porque es una fuente recién añadida— se va al histórico completo, que es
  // justo lo que hacía falta para recuperar las compras por Convert de
  // conexiones que ya tenían cursor.
  private since(cursor: BinanceCursor, source: string): number {
    const day = 86_400_000;
    const covered = cursor.coveredFrom?.[source];
    if (!covered) {
      const lookback =
        source === 'fiat' ? FIAT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS;
      return Date.now() - lookback * day;
    }
    return covered - 7 * day;
  }

  // Binance Convert: el canal por el que se compran cripto sin pasar por el
  // libro de órdenes. Ventana máxima de 30 días por llamada.
  private async fetchConvertTrades(
    creds: BrokerCredentials,
    cursor: BinanceCursor,
    warnings: string[],
  ): Promise<RawTransaction[]> {
    const rows: RawTransaction[] = [];
    for (const { start, end } of this.windows(
      this.since(cursor, 'convert'),
      CONVERT_WINDOW_DAYS,
    )) {
      try {
        const page = await this.signed<{
          list?: {
            quoteId: string;
            orderId: number;
            createTime: number;
            fromAsset: string;
            fromAmount: string;
            toAsset: string;
            toAmount: string;
            orderStatus: string;
          }[];
        }>(
          creds,
          '/sapi/v1/convert/tradeFlow',
          { startTime: String(start), endTime: String(end), limit: '100' },
          // Se espacian más que el libro de órdenes, pero sin exagerar: con un
          // peso muy alto el limitador esperaba hasta un minuto por llamada y
          // la sincronización completa tardaba veinte. Ante un 429 el respaldo
          // real es el retroceso exponencial, no ahogar el limitador.
          20,
        );
        for (const trade of page.list ?? []) {
          if (trade.orderStatus !== 'SUCCESS') {
            continue;
          }
          rows.push(...this.convertToTransactions(trade));
        }
      } catch (error) {
        warnings.push(`Convert: ${(error as Error).message}`);
        break;
      }
    }
    return rows;
  }

  // Una conversión con dinero en un lado es UNA compra o UNA venta. Entre dos
  // criptos son dos operaciones: se vende una y se compra la otra.
  private convertToTransactions(trade: {
    orderId: number;
    createTime: number;
    fromAsset: string;
    fromAmount: string;
    toAsset: string;
    toAmount: string;
  }): RawTransaction[] {
    const when = new Date(Number(trade.createTime));
    const occurredOn = toDateString(when)!;
    const fromAmount = Math.abs(Number(trade.fromAmount));
    const toAmount = Math.abs(Number(trade.toAmount));
    const base = {
      occurredOn,
      occurredAt: when,
      exchangeHint: 'BINANCE',
      assetClassHint: 'crypto' as const,
      fee: 0,
      tax: 0,
      settlementCurrency: null,
      settlementAmount: null,
      notes: `Binance Convert: ${trade.fromAsset} -> ${trade.toAsset}`,
      raw: trade as unknown as Record<string, unknown>,
    };

    const desdeDinero = CASH_ASSETS.has(trade.fromAsset);
    const haciaDinero = CASH_ASSETS.has(trade.toAsset);

    if (desdeDinero && !haciaDinero) {
      // dinero -> cripto: compra
      return [
        {
          ...base,
          type: InvestmentTransactionType.BUY,
          symbolHint: trade.toAsset,
          quantity: toAmount,
          price: toAmount ? fromAmount / toAmount : null,
          amount: fromAmount,
          currency: trade.fromAsset,
          externalId: `convert:${trade.orderId}:buy`,
        },
      ];
    }

    if (!desdeDinero && haciaDinero) {
      // cripto -> dinero: venta
      return [
        {
          ...base,
          type: InvestmentTransactionType.SELL,
          symbolHint: trade.fromAsset,
          quantity: fromAmount,
          price: fromAmount ? toAmount / fromAmount : null,
          amount: toAmount,
          currency: trade.toAsset,
          externalId: `convert:${trade.orderId}:sell`,
        },
      ];
    }

    if (!desdeDinero && !haciaDinero) {
      // cripto -> cripto: venta de una y compra de la otra
      return [
        {
          ...base,
          type: InvestmentTransactionType.SELL,
          symbolHint: trade.fromAsset,
          quantity: fromAmount,
          price: null,
          amount: 0,
          currency: trade.fromAsset,
          externalId: `convert:${trade.orderId}:sell`,
        },
        {
          ...base,
          type: InvestmentTransactionType.BUY,
          symbolHint: trade.toAsset,
          quantity: toAmount,
          price: null,
          amount: 0,
          currency: trade.toAsset,
          externalId: `convert:${trade.orderId}:buy`,
        },
      ];
    }

    // dinero -> dinero: es un cambio de divisa
    return [
      {
        ...base,
        type: InvestmentTransactionType.CURRENCY_EXCHANGE,
        symbolHint: null,
        quantity: null,
        price: null,
        amount: fromAmount,
        currency: trade.fromAsset,
        settlementCurrency: trade.toAsset,
        settlementAmount: toAmount,
        externalId: `convert:${trade.orderId}:fx`,
      },
    ];
  }

  // Depósitos y retiros de DINERO por la pasarela fiat (PSE, transferencia,
  // tarjeta). No son los mismos que /capital/deposit, que es para cripto.
  private async fetchFiatOrders(
    creds: BrokerCredentials,
    cursor: BinanceCursor,
    warnings: string[],
  ): Promise<RawTransaction[]> {
    const rows: RawTransaction[] = [];
    for (const tipo of ['0', '1'] as const) {
      for (const { start, end } of this.windows(
        this.since(cursor, 'fiat'),
        FIAT_WINDOW_DAYS,
      )) {
        try {
          const page = await this.signed<{
            data?: {
              orderNo: string;
              fiatCurrency: string;
              amount: string;
              totalFee: string;
              status: string;
              createTime: number;
              method?: string;
            }[];
          }>(
            creds,
            '/sapi/v1/fiat/orders',
            {
              transactionType: tipo,
              beginTime: String(start),
              endTime: String(end),
              rows: '100',
            },
            // fiat/orders es de los más caros del /sapi
            25,
          );
          for (const order of page.data ?? []) {
            // los intentos fallidos o expirados no son movimientos reales
            if (order.status !== 'Successful') {
              continue;
            }
            const when = new Date(Number(order.createTime));
            rows.push({
              type:
                tipo === '0'
                  ? InvestmentTransactionType.DEPOSIT
                  : InvestmentTransactionType.WITHDRAWAL,
              occurredOn: toDateString(when)!,
              occurredAt: when,
              symbolHint: null,
              exchangeHint: null,
              quantity: null,
              price: null,
              amount: Math.abs(Number(order.amount)),
              fee: Math.abs(Number(order.totalFee ?? 0)),
              tax: 0,
              currency: order.fiatCurrency,
              settlementCurrency: null,
              settlementAmount: null,
              externalId: `fiat:${order.orderNo}`,
              notes: order.method ? `Binance ${order.method}` : null,
              raw: order as unknown as Record<string, unknown>,
            });
          }
        } catch (error) {
          warnings.push(`Órdenes fiat: ${(error as Error).message}`);
          break;
        }
      }
    }
    return rows;
  }

  private async fetchCashMovements(
    creds: BrokerCredentials,
    warnings: string[],
  ): Promise<RawTransaction[]> {
    const rows: RawTransaction[] = [];

    const safely = async (label: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        warnings.push(`${label}: ${(error as Error).message}`);
      }
    };

    await safely('depósitos', async () => {
      const deposits = await this.signed<
        { amount: string; coin: string; insertTime: number; txId: string }[]
      >(creds, '/sapi/v1/capital/deposit/hisrec', {});
      for (const deposit of deposits) {
        rows.push(
          this.cashRow(
            InvestmentTransactionType.DEPOSIT,
            Number(deposit.amount),
            deposit.coin,
            deposit.insertTime,
            deposit.txId,
            deposit as unknown as Record<string, unknown>,
          ),
        );
      }
    });

    await safely('retiros', async () => {
      const withdrawals = await this.signed<
        { amount: string; coin: string; applyTime: string; id: string }[]
      >(creds, '/sapi/v1/capital/withdraw/history', {});
      for (const withdrawal of withdrawals) {
        rows.push(
          this.cashRow(
            InvestmentTransactionType.WITHDRAWAL,
            Number(withdrawal.amount),
            withdrawal.coin,
            Date.parse(withdrawal.applyTime),
            withdrawal.id,
            withdrawal as unknown as Record<string, unknown>,
          ),
        );
      }
    });

    await safely('distribuciones', async () => {
      const dividends = await this.signed<{
        rows: {
          amount: string;
          asset: string;
          divTime: number;
          tranId: number;
        }[];
      }>(creds, '/sapi/v1/asset/assetDividend', { limit: '500' });
      for (const dividend of dividends.rows ?? []) {
        rows.push(
          this.cashRow(
            InvestmentTransactionType.DIVIDEND,
            Number(dividend.amount),
            dividend.asset,
            dividend.divTime,
            String(dividend.tranId),
            dividend as unknown as Record<string, unknown>,
          ),
        );
      }
    });

    return rows;
  }

  private toTrade(
    symbol: string,
    trade: {
      id: number;
      price: string;
      qty: string;
      quoteQty: string;
      commission: string;
      commissionAsset: string;
      time: number;
      isBuyer: boolean;
    },
  ): RawTransaction {
    const when = new Date(trade.time);
    return {
      type: trade.isBuyer
        ? InvestmentTransactionType.BUY
        : InvestmentTransactionType.SELL,
      occurredOn: toDateString(when)!,
      occurredAt: when,
      symbolHint: symbol,
      exchangeHint: 'BINANCE',
      assetClassHint: 'crypto',
      quantity: Number(trade.qty),
      price: Number(trade.price),
      amount: Number(trade.quoteQty),
      // la comisión puede venir en otra moneda; se toma el número y la moneda
      // de la operación, que es lo que el libro puede representar
      fee: Number(trade.commission),
      tax: 0,
      currency: this.quoteAsset(symbol),
      settlementCurrency: null,
      settlementAmount: null,
      externalId: `trade:${symbol}:${trade.id}`,
      notes: null,
      raw: { symbol, ...trade },
    };
  }

  private cashRow(
    type: InvestmentTransactionType,
    amount: number,
    asset: string,
    timestamp: number,
    externalId: string,
    raw: Record<string, unknown>,
  ): RawTransaction {
    const when = new Date(timestamp);
    return {
      type,
      occurredOn: toDateString(when)!,
      occurredAt: when,
      symbolHint: null,
      exchangeHint: null,
      quantity: null,
      price: null,
      amount: Math.abs(amount),
      fee: 0,
      tax: 0,
      currency: asset,
      settlementCurrency: null,
      settlementAmount: null,
      externalId: `${type}:${externalId}`,
      notes: null,
      raw,
    };
  }

  private quoteAsset(symbol: string): string {
    return resolveQuoteAsset(symbol, DEFAULT_QUOTES);
  }

  // --- HTTP ---

  // La firma incluye el timestamp, así que un reintento NO puede reenviar la
  // misma URL: hay que volver a firmar con la hora nueva. Por eso el reintento
  // vive aquí y no en request().
  private async signed<T>(
    creds: BrokerCredentials,
    path: string,
    params: Record<string, string>,
    weight = 10,
  ): Promise<T> {
    const apiKey = creds.require('apiKey');
    const apiSecret = creds.require('apiSecret');

    let ultimo: Error | null = null;
    for (let intento = 0; intento < MAX_RETRIES; intento += 1) {
      const query = new URLSearchParams({
        ...params,
        recvWindow: String(RECV_WINDOW),
        timestamp: String(Date.now()),
      });
      // HMAC-SHA256 con el crypto nativo: cero dependencias nuevas
      query.set(
        'signature',
        createHmac('sha256', apiSecret).update(query.toString()).digest('hex'),
      );

      try {
        return await this.request<T>(`${path}?${query.toString()}`, weight, {
          'X-MBX-APIKEY': apiKey,
        });
      } catch (error) {
        ultimo = error as Error;
        const mensaje = ultimo.message;
        // -1021: el timestamp quedó fuera de la ventana. Firmar de nuevo con la
        // hora actual suele bastar.
        const derivaReloj = mensaje.includes('-1021');
        // -1003 / 429 / 418: hay que ESPERAR, no insistir. Seguir martilleando
        // puede acabar en un bloqueo temporal de la IP.
        const limitado =
          mensaje.includes('-1003') ||
          mensaje.includes(' 429') ||
          mensaje.includes(' 418');

        if (!derivaReloj && !limitado) {
          throw ultimo;
        }
        if (intento === MAX_RETRIES - 1) {
          break;
        }
        if (limitado) {
          const espera = BACKOFF_BASE_MS * 2 ** intento;
          this.logger.warn(
            `Binance limitó la petición; se espera ${espera} ms antes de reintentar`,
          );
          await new Promise((resolve) => setTimeout(resolve, espera));
        }
      }
    }
    throw ultimo ?? new BadGatewayException('Binance no respondió');
  }

  private publicGet<T>(
    path: string,
    params: Record<string, string>,
    weight = 1,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    return this.request<T>(query ? `${path}?${query}` : path, weight, {});
  }

  private async request<T>(
    pathWithQuery: string,
    weight: number,
    headers: Record<string, string>,
  ): Promise<T> {
    await this.bucket.take(weight);
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${pathWithQuery}`, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException(
        `No se pudo contactar con Binance: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new BadGatewayException(
        `Binance respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    return (await response.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Lógica pura, extraída para poder probarla sin red. Es justo donde estaban
// los fallos que impedían que llegaran las operaciones de un activo vendido.
// ---------------------------------------------------------------------------

// Tope de pares por sincronización. Ampliar las monedas de cotización mejora
// la cobertura pero multiplica las llamadas, y cada /myTrades pesa 10 en la
// cuota de Binance. Mejor acotarlo y AVISAR que martillear la API en silencio.
export const MAX_CANDIDATE_PAIRS = 120;

export interface CandidatePairsInput {
  /** activos con saldo actual, más los que el usuario ya ha operado */
  assets: Set<string> | string[];
  /** pares que sincronizaciones anteriores dejaron en el cursor */
  previousPairs: string[];
  quotes: string[];
  /** pares que Binance reconoce */
  validSymbols: Set<string>;
}

export function buildCandidatePairs(input: CandidatePairsInput): string[] {
  const candidates = new Set<string>();

  // Los pares ya vistos entran SIEMPRE, aunque el activo ya no tenga saldo.
  // Sin esto, vender todo tu BTC hacía desaparecer BTCUSDT del conjunto y su
  // histórico no volvía a traerse nunca.
  for (const pair of input.previousPairs) {
    if (input.validSymbols.has(pair)) {
      candidates.add(pair);
    }
  }

  for (const asset of input.assets) {
    for (const quote of input.quotes) {
      if (asset === quote) {
        continue;
      }
      const symbol = `${asset}${quote}`;
      if (input.validSymbols.has(symbol)) {
        candidates.add(symbol);
      }
    }
  }
  // los pares ya vistos van primero: son los que de verdad tienen operaciones
  return [...candidates].slice(0, MAX_CANDIDATE_PAIRS);
}

// Sufijo MÁS LARGO que case: "BTCUSDC" tiene que dar USDC, no USD ni USDT.
export function resolveQuoteAsset(symbol: string, quotes: string[]): string {
  const quote = [...quotes]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => symbol.endsWith(candidate));
  return quote ?? 'USDT';
}

export { DEFAULT_QUOTES };

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
const RECV_WINDOW = 10_000;

// Binance cuenta "peso" por endpoint; 1200/minuto es el tope de la cuenta.
// Se deja margen porque /myTrades pesa más que una consulta simple.
const WEIGHT_LIMIT = 400;
const WEIGHT_WINDOW_MS = 60_000;

// Monedas de cotización por defecto contra las que buscar pares. El usuario
// puede cambiarlas en las credenciales.
const DEFAULT_QUOTES = ['USDT', 'BTC', 'BUSD', 'EUR'];

interface BinanceCursor extends SyncCursor {
  /** último tradeId visto por símbolo */
  fromId?: Record<string, number>;
  lastSyncedAt?: number;
}

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

    const symbols = await this.candidateSymbols(creds);
    if (symbols.length === 0) {
      warnings.push(
        'No se encontraron pares con saldo; añade "pairs" a las credenciales si operas otros',
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

    return {
      rows,
      cursor: { fromId, lastSyncedAt: Date.now() } satisfies BinanceCursor,
      partial: warnings.length > 0,
      warnings,
    };
  }

  private async candidateSymbols(creds: BrokerCredentials): Promise<string[]> {
    const quotes = creds.get<string[]>('pairs') ?? DEFAULT_QUOTES;
    const account = await this.signed<{
      balances: { asset: string; free: string; locked: string }[];
    }>(creds, '/api/v3/account', {});

    const assets = (account.balances ?? [])
      .filter((balance) => Number(balance.free) + Number(balance.locked) > 0)
      .map((balance) => balance.asset);

    const valid = await this.exchangeSymbols();
    const candidates = new Set<string>();
    for (const asset of assets) {
      for (const quote of quotes) {
        if (asset === quote) {
          continue;
        }
        const symbol = `${asset}${quote}`;
        if (valid.has(symbol)) {
          candidates.add(symbol);
        }
      }
    }
    return [...candidates];
  }

  private async exchangeSymbols(): Promise<Set<string>> {
    const info = await this.publicGet<{ symbols: { symbol: string }[] }>(
      '/api/v3/exchangeInfo',
      {},
      10,
    );
    return new Set((info.symbols ?? []).map((entry) => entry.symbol));
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
    const quote = DEFAULT_QUOTES.find((candidate) =>
      symbol.endsWith(candidate),
    );
    return quote ?? 'USDT';
  }

  // --- HTTP ---

  private async signed<T>(
    creds: BrokerCredentials,
    path: string,
    params: Record<string, string>,
    weight = 10,
  ): Promise<T> {
    const apiKey = creds.require('apiKey');
    const apiSecret = creds.require('apiSecret');

    const query = new URLSearchParams({
      ...params,
      recvWindow: String(RECV_WINDOW),
      timestamp: String(Date.now()),
    });
    // HMAC-SHA256 con el crypto nativo: cero dependencias nuevas
    const signature = createHmac('sha256', apiSecret)
      .update(query.toString())
      .digest('hex');
    query.set('signature', signature);

    return this.request<T>(`${path}?${query.toString()}`, weight, {
      'X-MBX-APIKEY': apiKey,
    });
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

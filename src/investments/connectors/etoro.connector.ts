import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { toDateString } from '../../common/date';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
import { TokenBucket } from '../../common/rate-limit/token-bucket';
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

const BASE_URL = 'https://www.etoro.com';
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 200;

// La cuota compartida de eToro es 60 peticiones por 60 s.
const RATE_LIMIT = 55;
const RATE_WINDOW_MS = 60_000;

// eToro NO deja mirar más de un año atrás en el historial. Es limitación suya,
// no nuestra: para traer histórico más antiguo hay que importar el statement
// por archivo.
const MAX_LOOKBACK_DAYS = 365;

interface EtoroCursor extends SyncCursor {
  lastSyncedOn?: string;
}

@Injectable()
export class EtoroConnector implements BrokerConnector {
  readonly broker = BrokerKind.ETORO;
  private readonly logger = new Logger(EtoroConnector.name);
  private readonly bucket = new TokenBucket(RATE_LIMIT, RATE_WINDOW_MS);

  async verifyCredentials(creds: BrokerCredentials): Promise<BrokerIdentity> {
    const profile = await this.get<{
      username?: string;
      userId?: number;
      realCID?: number;
    }>(creds, '/api/v1/user/profile');
    return {
      accountId: profile.realCID ? String(profile.realCID) : null,
      displayName: profile.username ?? 'eToro',
      currency: 'USD',
    };
  }

  async fetchAccounts(creds: BrokerCredentials): Promise<RawAccount[]> {
    const identity = await this.verifyCredentials(creds);
    return [
      {
        externalId: identity.accountId ?? 'etoro',
        name: identity.displayName ?? 'eToro',
        // eToro liquida en USD
        currency: 'USD',
      },
    ];
  }

  async fetchPositions(
    creds: BrokerCredentials,
    account: AccountRef,
  ): Promise<RawPosition[]> {
    void account;
    const portfolio = await this.get<{
      positions?: { instrumentId: number; units: number }[];
    }>(creds, '/api/v1/trading/real/portfolio');
    return (portfolio.positions ?? []).map((position) => ({
      symbolHint: String(position.instrumentId),
      quantity: position.units,
      currency: 'USD',
    }));
  }

  async fetchTransactions(
    creds: BrokerCredentials,
    account: AccountRef,
    cursor: SyncCursor | null,
  ): Promise<FetchResult> {
    void account;
    const previous = (cursor ?? {}) as EtoroCursor;
    const warnings: string[] = [];

    const earliest = this.minDate();
    // se re-consulta una semana por detrás del cursor a propósito: deduplicar
    // es gratis y ese solape es justo lo que atrapa las operaciones que el
    // bróker liquida tarde o corrige después
    const requested = previous.lastSyncedOn
      ? this.shift(previous.lastSyncedOn, -7)
      : earliest;
    const minDate = requested < earliest ? earliest : requested;

    if (requested < earliest) {
      warnings.push(
        'eToro solo permite consultar un año de historial. Para traer operaciones ' +
          'más antiguas, importa el statement en CSV o XLSX.',
      );
    }

    const rows: RawTransaction[] = [];
    let page = 1;
    let partial = false;

    for (;;) {
      const response = await this.get<{
        items?: EtoroHistoryItem[];
        totalItems?: number;
      }>(
        creds,
        `/api/v1/trading/info/trade/history?minDate=${minDate}&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      const items = response.items ?? [];
      for (const item of items) {
        rows.push(...this.toTransactions(item));
      }
      if (items.length < PAGE_SIZE) {
        break;
      }
      page += 1;
      if (page > 50) {
        partial = true;
        warnings.push('Demasiadas páginas de historial; se truncó la descarga');
        break;
      }
    }

    return {
      rows,
      cursor: {
        lastSyncedOn: toDateString(new Date())!,
      } satisfies EtoroCursor,
      partial,
      warnings,
    };
  }

  // Una posición cerrada de eToro es DOS operaciones nuestras: la apertura y
  // el cierre. El bróker lo cuenta como una sola fila.
  private toTransactions(item: EtoroHistoryItem): RawTransaction[] {
    const rows: RawTransaction[] = [];
    const symbol = String(item.instrumentId ?? '');
    const openedAt = item.openTimestamp ? new Date(item.openTimestamp) : null;
    const closedAt = item.closeTimestamp ? new Date(item.closeTimestamp) : null;
    const units = Number(item.units ?? 0);

    if (openedAt && units > 0) {
      rows.push({
        type: item.isBuy
          ? InvestmentTransactionType.BUY
          : InvestmentTransactionType.SELL,
        occurredOn: toDateString(openedAt)!,
        occurredAt: openedAt,
        symbolHint: symbol,
        exchangeHint: null,
        quantity: units,
        price: Number(item.openRate ?? 0),
        amount: Number(item.initialInvestment ?? item.investment ?? 0),
        fee: Math.abs(Number(item.fees ?? 0)),
        tax: 0,
        currency: 'USD',
        settlementCurrency: null,
        settlementAmount: null,
        externalId: `open:${item.positionId}`,
        notes: null,
        raw: item as unknown as Record<string, unknown>,
      });
    }

    if (closedAt && units > 0) {
      rows.push({
        type: item.isBuy
          ? InvestmentTransactionType.SELL
          : InvestmentTransactionType.BUY,
        occurredOn: toDateString(closedAt)!,
        occurredAt: closedAt,
        symbolHint: symbol,
        exchangeHint: null,
        quantity: units,
        price: Number(item.closeRate ?? 0),
        amount: Math.abs(
          Number(item.investment ?? 0) + Number(item.netProfit ?? 0),
        ),
        fee: 0,
        tax: 0,
        currency: 'USD',
        settlementCurrency: null,
        settlementAmount: null,
        externalId: `close:${item.positionId}`,
        notes: null,
        raw: item as unknown as Record<string, unknown>,
      });
    }

    return rows;
  }

  private minDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - MAX_LOOKBACK_DAYS + 1);
    return toDateString(date)!;
  }

  private shift(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().substring(0, 10);
  }

  private async get<T>(creds: BrokerCredentials, path: string): Promise<T> {
    await this.bucket.take(1);
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        headers: {
          Accept: 'application/json',
          // un x-request-id nuevo por petición, como exige eToro
          'x-request-id': randomUUID(),
          'x-api-key': creds.require('apiKey'),
          'x-user-key': creds.require('userKey'),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException(
        `No se pudo contactar con eToro: ${(error as Error).message}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new BadGatewayException(
        'eToro rechazó las credenciales: revisa la API key y la user key',
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new BadGatewayException(
        `eToro respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    return (await response.json()) as T;
  }
}

interface EtoroHistoryItem {
  positionId?: number;
  instrumentId?: number;
  isBuy?: boolean;
  units?: number;
  openRate?: number;
  closeRate?: number;
  openTimestamp?: string;
  closeTimestamp?: string;
  investment?: number;
  initialInvestment?: number;
  netProfit?: number;
  fees?: number;
}

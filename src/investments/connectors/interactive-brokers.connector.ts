import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
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

const BASE_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const TIMEOUT_MS = 30_000;
// IBKR limita a ~1 petición por segundo y por token
const RATE_LIMIT = 1;
const RATE_WINDOW_MS = 1_100;
// el statement no está listo al instante: hay que sondear
const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 3_000;

interface IbkrCursor extends SyncCursor {
  lastStatementTo?: string;
}

// Se usa el Flex Web Service, NO la Client Portal API.
//
// La Client Portal API exige un gateway corriendo en local y un 2FA manual a
// diario: inviable para un backend desatendido. Flex funciona con un token y
// un query id que el usuario crea una vez en Account Management.
@Injectable()
export class InteractiveBrokersConnector implements BrokerConnector {
  readonly broker = BrokerKind.INTERACTIVE_BROKERS;
  private readonly logger = new Logger(InteractiveBrokersConnector.name);
  private readonly bucket = new TokenBucket(RATE_LIMIT, RATE_WINDOW_MS);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  });

  async verifyCredentials(creds: BrokerCredentials): Promise<BrokerIdentity> {
    const statement = await this.fetchStatement(creds);
    const account = this.first(statement?.AccountInformation);
    return {
      accountId: account?.accountId ?? null,
      displayName: account?.name ?? 'Interactive Brokers',
      currency: account?.currency ?? 'USD',
    };
  }

  async fetchAccounts(creds: BrokerCredentials): Promise<RawAccount[]> {
    const identity = await this.verifyCredentials(creds);
    return [
      {
        externalId: identity.accountId ?? 'ibkr',
        name: identity.displayName ?? 'Interactive Brokers',
        currency: identity.currency ?? 'USD',
      },
    ];
  }

  async fetchPositions(
    creds: BrokerCredentials,
    account: AccountRef,
  ): Promise<RawPosition[]> {
    void account;
    const statement = await this.fetchStatement(creds);
    return this.list(statement?.OpenPositions?.OpenPosition).map(
      (position) => ({
        symbolHint: String(position.symbol ?? ''),
        quantity: Number(position.position ?? 0),
        currency: String(position.currency ?? 'USD'),
      }),
    );
  }

  async fetchTransactions(
    creds: BrokerCredentials,
    account: AccountRef,
    cursor: SyncCursor | null,
  ): Promise<FetchResult> {
    void account;
    void cursor;
    const warnings: string[] = [];
    const statement = await this.fetchStatement(creds);
    const rows: RawTransaction[] = [];

    for (const trade of this.list(statement?.Trades?.Trade)) {
      const row = this.toTrade(trade);
      if (row) {
        rows.push(row);
      }
    }

    for (const item of this.list(
      statement?.CashTransactions?.CashTransaction,
    )) {
      const row = this.toCashTransaction(item);
      if (row) {
        rows.push(row);
      } else {
        warnings.push(
          `Movimiento de efectivo no reconocido: ${String(item.type ?? '')}`,
        );
      }
    }

    const toDate =
      this.first(statement?.AccountInformation) && statement?.toDate
        ? String(statement.toDate)
        : toDateString(new Date())!;

    return {
      rows,
      cursor: { lastStatementTo: toDate } satisfies IbkrCursor,
      // el rango lo fija la Flex Query del usuario, no nosotros: si la
      // configuró corta, no se puede saber desde aquí
      partial: false,
      warnings,
    };
  }

  private toTrade(trade: IbkrNode): RawTransaction | null {
    const date = this.parseDate(trade.tradeDate ?? trade.dateTime);
    if (!date) {
      return null;
    }
    const quantity = Number(trade.quantity ?? 0);
    const isBuy = quantity >= 0;
    return {
      type: isBuy
        ? InvestmentTransactionType.BUY
        : InvestmentTransactionType.SELL,
      occurredOn: date,
      occurredAt: null,
      symbolHint: String(trade.symbol ?? ''),
      exchangeHint: trade.exchange ? String(trade.exchange) : null,
      // el signo lo lleva el tipo, nunca la cantidad
      quantity: Math.abs(quantity),
      price: Math.abs(Number(trade.tradePrice ?? 0)),
      amount: Math.abs(Number(trade.proceeds ?? trade.tradeMoney ?? 0)),
      fee: Math.abs(Number(trade.ibCommission ?? 0)),
      tax: Math.abs(Number(trade.taxes ?? 0)),
      currency: String(trade.currency ?? 'USD'),
      settlementCurrency: null,
      settlementAmount: null,
      externalId: trade.transactionID
        ? `trade:${String(trade.transactionID)}`
        : null,
      notes: trade.description ? String(trade.description) : null,
      raw: trade as Record<string, unknown>,
    };
  }

  private toCashTransaction(item: IbkrNode): RawTransaction | null {
    const date = this.parseDate(item.dateTime ?? item.settleDate);
    if (!date) {
      return null;
    }
    const amount = Number(item.amount ?? 0);
    const type = this.mapCashType(String(item.type ?? ''), amount);
    if (!type) {
      return null;
    }
    return {
      type,
      occurredOn: date,
      occurredAt: null,
      symbolHint: item.symbol ? String(item.symbol) : null,
      exchangeHint: null,
      quantity: null,
      price: null,
      amount: Math.abs(amount),
      fee: 0,
      tax: 0,
      currency: String(item.currency ?? 'USD'),
      settlementCurrency: null,
      settlementAmount: null,
      externalId: item.transactionID
        ? `cash:${String(item.transactionID)}`
        : null,
      notes: item.description ? String(item.description) : null,
      raw: item as Record<string, unknown>,
    };
  }

  private mapCashType(
    rawType: string,
    amount: number,
  ): InvestmentTransactionType | null {
    const type = rawType.toLowerCase();
    if (type.includes('dividend')) {
      return InvestmentTransactionType.DIVIDEND;
    }
    if (type.includes('withholding') || type.includes('tax')) {
      return InvestmentTransactionType.TAX;
    }
    if (type.includes('interest')) {
      // IBKR usa el mismo tipo para intereses cobrados y pagados; el signo
      // decide cuál es
      return amount >= 0
        ? InvestmentTransactionType.INTEREST
        : InvestmentTransactionType.FEE;
    }
    if (type.includes('fee') || type.includes('commission')) {
      return InvestmentTransactionType.FEE;
    }
    if (type.includes('deposit') || type.includes('withdrawal')) {
      return amount >= 0
        ? InvestmentTransactionType.DEPOSIT
        : InvestmentTransactionType.WITHDRAWAL;
    }
    return null;
  }

  // IBKR escribe las fechas como 20260901 o 2026-09-01, a veces con hora
  private parseDate(value: unknown): string | null {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    const compact = /^(\d{4})(\d{2})(\d{2})/.exec(text);
    if (compact) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  // --- Flex Web Service: dos pasos ---

  private async fetchStatement(
    creds: BrokerCredentials,
  ): Promise<IbkrNode | null> {
    const token = creds.require('token');
    const queryId = creds.require('queryId');

    const request = await this.get(
      `${BASE_URL}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`,
    );
    const parsedRequest = this.parser.parse(request) as {
      FlexStatementResponse?: {
        Status?: string;
        ReferenceCode?: string | number;
        ErrorMessage?: string;
      };
    };
    const response = parsedRequest.FlexStatementResponse;
    if (!response || response.Status !== 'Success' || !response.ReferenceCode) {
      const message = response?.ErrorMessage ?? 'respuesta inesperada';
      if (String(message).toLowerCase().includes('token')) {
        // el token de Flex caduca; hay que regenerarlo en Account Management
        throw new BadGatewayException(
          `Interactive Brokers rechazó el token: ${message}`,
        );
      }
      throw new BadGatewayException(
        `Interactive Brokers no aceptó la petición: ${message}`,
      );
    }

    // el statement tarda en generarse: se sondea con espera entre intentos
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const body = await this.get(
        `${BASE_URL}/GetStatement?t=${encodeURIComponent(token)}&q=${encodeURIComponent(
          String(response.ReferenceCode),
        )}&v=3`,
      );
      const parsed = this.parser.parse(body) as {
        FlexQueryResponse?: { FlexStatements?: { FlexStatement?: unknown } };
        FlexStatementResponse?: { ErrorMessage?: string };
      };
      const statement = this.first(
        parsed.FlexQueryResponse?.FlexStatements?.FlexStatement,
      );
      if (statement) {
        return statement;
      }
      const error = parsed.FlexStatementResponse?.ErrorMessage;
      if (error && !String(error).toLowerCase().includes('not yet')) {
        throw new BadGatewayException(
          `Interactive Brokers devolvió un error: ${error}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
    }

    throw new BadGatewayException(
      'El statement de Interactive Brokers no estuvo listo a tiempo; inténtalo de nuevo',
    );
  }

  private async get(url: string): Promise<string> {
    await this.bucket.take(1);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/xml' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException(
        `No se pudo contactar con Interactive Brokers: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `Interactive Brokers respondió ${response.status}`,
      );
    }
    return response.text();
  }

  // fast-xml-parser devuelve un objeto cuando hay un solo elemento y un array
  // cuando hay varios; esto normaliza los dos casos
  private list(value: unknown): IbkrNode[] {
    if (!value) {
      return [];
    }
    return (Array.isArray(value) ? value : [value]) as IbkrNode[];
  }

  private first(value: unknown): IbkrNode | null {
    return this.list(value)[0] ?? null;
  }
}

type IbkrNode = Record<string, unknown> & {
  AccountInformation?: unknown;
  OpenPositions?: { OpenPosition?: unknown };
  Trades?: { Trade?: unknown };
  CashTransactions?: { CashTransaction?: unknown };
  accountId?: string;
  name?: string;
  currency?: string;
  toDate?: string;
};

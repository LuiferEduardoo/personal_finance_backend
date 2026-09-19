import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
// import con nombre, NO por defecto: `ws` es CommonJS y el repo tiene
// allowSyntheticDefaultImports SIN esModuleInterop, así que un import por
// defecto compila y luego revienta con "is not a constructor".
import { WebSocket } from 'ws';
import { toDateString } from '../../common/date';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
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

// ---------------------------------------------------------------------------
// ESTADO DE ESTE CONECTOR: el protocolo que habla ya no sirve para cuentas
// minoristas de XTB. Verificado contra los servidores el 19/09/2026:
//
//   ws.xtb.com/{real,demo}          -> HTTP 404. XTB retiró su xAPI público.
//   ws.xapi.pro/{real,demo}         -> habla el xAPI clásico, pero es la
//                                      plataforma X Open Hub (marca blanca).
//                                      Una cuenta XTB recibe ahí EX017,
//                                      "account from a different platform".
//   api5reala.x-station.eu/v1/...   -> conecta, pero NO entiende el xAPI
//                                      clásico: rechaza el JSON con un error
//                                      de parseo. Es otro protocolo (CoreAPI
//                                      con autenticación CAS de tres pasos).
//
// La librería de referencia del CoreAPI expone getBalance, getPositions, buy y
// sell, pero NO histórico de operaciones, que es justo lo que necesita un libro
// de cartera. Mientras eso siga así, la importación del statement por CSV o
// XLSX es la vía que de verdad funciona para XTB.
// ---------------------------------------------------------------------------
const REAL_URL = 'wss://ws.xapi.pro/real';
const DEMO_URL = 'wss://ws.xapi.pro/demo';

// XTB responde esto cuando la cuenta existe pero vive en otra plataforma.
// No se arregla cambiando la contraseña, así que el mensaje tiene que decirlo.
const WRONG_PLATFORM_CODE = 'EX017';
const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 20_000;
// XTB corta la sesión si no hay actividad
const PING_INTERVAL_MS = 8_000;
const IDLE_CLOSE_MS = 30_000;
// el protocolo exige ~200 ms entre comandos
const COMMAND_GAP_MS = 250;
// Cuánto histórico pedir cuando no hay cursor. getTradesHistory EXIGE `start`
// (sin él devuelve INVALID_ARGUMENTS, verificado contra el servidor).
const DEFAULT_HISTORY_DAYS = 730;
// solape al resincronizar: deduplicar es gratis y atrapa correcciones tardías
const OVERLAP_DAYS = 7;

interface XtbCursor extends SyncCursor {
  lastSyncedAt?: number;
}

// ---------------------------------------------------------------------------
// XTB NO tiene API oficial. Esto habla el protocolo no oficial de xStation5.
//
// A diferencia de los otros tres brókers, aquí NO hay una API key revocable de
// solo lectura: se autentica con el usuario y la contraseña REALES de trading.
// Por eso este conector aplica contención extra:
//
//  1. Las credenciales se descifran SOLO aquí, viven en una variable local
//     durante una sincronización y nunca se guardan en un campo de la clase.
//  2. BrokerCredentials.toJSON() devuelve '[redacted]', así que un log que
//     serialice el objeto no puede filtrar la contraseña.
//  3. La mutación que las guarda usa GqlUserOnlyGuard y NO lleva @Scopes:
//     cerrada por partida doble a las API keys.
//  4. .env.example lo dice sin rodeos: un volcado de la base MÁS una fuga de
//     la clave equivale a comprometer la cuenta de trading entera.
//  5. La documentación recomienda empezar con credenciales de DEMO.
//
// Además, el protocolo puede cambiar sin aviso: XTB no lo soporta.
// ---------------------------------------------------------------------------
@Injectable()
export class XtbConnector implements BrokerConnector {
  readonly broker = BrokerKind.XTB;
  private readonly logger = new Logger(XtbConnector.name);

  async verifyCredentials(creds: BrokerCredentials): Promise<BrokerIdentity> {
    return this.withSession(creds, async (session) => {
      const data = await session.command<{
        currency?: string;
        companyUnit?: number;
      }>('getCurrentUserData', {});
      return {
        accountId: creds.get('userId') ?? null,
        displayName: 'XTB',
        currency: data.currency ?? 'EUR',
      };
    });
  }

  async fetchAccounts(creds: BrokerCredentials): Promise<RawAccount[]> {
    const identity = await this.verifyCredentials(creds);
    return [
      {
        externalId: identity.accountId ?? 'xtb',
        name: identity.displayName ?? 'XTB',
        currency: identity.currency ?? 'EUR',
      },
    ];
  }

  async fetchPositions(
    creds: BrokerCredentials,
    account: AccountRef,
  ): Promise<RawPosition[]> {
    void account;
    return this.withSession(creds, async (session) => {
      const trades = await session.command<XtbTrade[]>('getTrades', {
        openedOnly: true,
      });
      return (trades ?? []).map((trade) => ({
        symbolHint: trade.symbol ?? '',
        quantity: Number(trade.volume ?? 0),
        currency: null,
      }));
    });
  }

  async fetchTransactions(
    creds: BrokerCredentials,
    account: AccountRef,
    cursor: SyncCursor | null,
  ): Promise<FetchResult> {
    const currency = account.currency || 'EUR';
    const previous = (cursor ?? {}) as XtbCursor;

    // Desde cuándo pedir el histórico. Se retrocede una semana sobre el cursor
    // a propósito: deduplicar no cuesta nada y ese solape atrapa las
    // operaciones que el bróker liquida tarde.
    const start = previous.lastSyncedAt
      ? previous.lastSyncedAt - OVERLAP_DAYS * 86_400_000
      : Date.now() - DEFAULT_HISTORY_DAYS * 86_400_000;

    return this.withSession(creds, async (session) => {
      const warnings: string[] = [];
      const rows: RawTransaction[] = [];

      // Hacen falta LOS DOS comandos, y esto es lo que antes estaba mal:
      // getTrades devuelve únicamente las posiciones ABIERTAS, por mucho que se
      // le pase openedOnly:false. El histórico de operaciones cerradas vive en
      // getTradesHistory, que exige `start` en milisegundos desde 1970.
      const cerradas = await session.command<XtbTrade[]>('getTradesHistory', {
        start,
        end: 0,
      });
      for (const trade of cerradas ?? []) {
        rows.push(...this.toTransactions(trade, currency));
      }

      const abiertas = await session.command<XtbTrade[]>('getTrades', {
        openedOnly: true,
      });
      for (const trade of abiertas ?? []) {
        rows.push(...this.toTransactions(trade, currency));
      }

      if (rows.length === 0) {
        warnings.push(
          'XTB no devolvió operaciones en el periodo consultado. Su API no oficial ' +
            'limita cuánto histórico expone; para lo más antiguo, importa el ' +
            'statement en CSV o XLSX.',
        );
      }

      return {
        rows,
        cursor: { lastSyncedAt: Date.now() } satisfies XtbCursor,
        partial: true,
        warnings,
      };
    });
  }

  // Una operación cerrada de XTB son dos filas nuestras: apertura y cierre.
  private toTransactions(trade: XtbTrade, currency: string): RawTransaction[] {
    const rows: RawTransaction[] = [];
    const volume = Math.abs(Number(trade.volume ?? 0));
    if (volume === 0 || !trade.symbol) {
      return rows;
    }

    const openedAt = trade.open_time ? new Date(trade.open_time) : null;
    if (openedAt) {
      const openPrice = Math.abs(Number(trade.open_price ?? 0));
      rows.push({
        // cmd 0 = compra, 1 = venta en el protocolo de XTB
        type:
          trade.cmd === 1
            ? InvestmentTransactionType.SELL
            : InvestmentTransactionType.BUY,
        occurredOn: toDateString(openedAt)!,
        occurredAt: openedAt,
        symbolHint: trade.symbol,
        exchangeHint: null,
        quantity: volume,
        price: openPrice,
        amount: volume * openPrice,
        fee: Math.abs(Number(trade.commission ?? 0)),
        tax: 0,
        currency,
        settlementCurrency: null,
        settlementAmount: null,
        externalId: `open:${trade.position ?? trade.order ?? ''}`,
        notes: trade.customComment ?? null,
        raw: trade as unknown as Record<string, unknown>,
      });
    }

    const closedAt = trade.close_time ? new Date(trade.close_time) : null;
    if (closedAt) {
      const closePrice = Math.abs(Number(trade.close_price ?? 0));
      rows.push({
        type:
          trade.cmd === 1
            ? InvestmentTransactionType.BUY
            : InvestmentTransactionType.SELL,
        occurredOn: toDateString(closedAt)!,
        occurredAt: closedAt,
        symbolHint: trade.symbol,
        exchangeHint: null,
        quantity: volume,
        price: closePrice,
        amount: volume * closePrice,
        fee: 0,
        tax: 0,
        currency,
        settlementCurrency: null,
        settlementAmount: null,
        externalId: `close:${trade.position ?? trade.order ?? ''}`,
        notes: null,
        raw: trade as unknown as Record<string, unknown>,
      });
    }

    return rows;
  }

  // Abre la sesión, ejecuta el trabajo y la cierra SIEMPRE. Las credenciales
  // viven solo dentro de esta llamada.
  private async withSession<T>(
    creds: BrokerCredentials,
    work: (session: XtbSession) => Promise<T>,
  ): Promise<T> {
    const isDemo = creds.get<boolean>('isDemo') === true;
    const session = new XtbSession(isDemo ? DEMO_URL : REAL_URL, this.logger);
    try {
      await session.open();
      await session.login(creds.require('userId'), creds.require('password'));
      return await work(session);
    } finally {
      session.close();
    }
  }
}

// Sesión WebSocket contra xStation5. Comandos JSON, respuestas correlacionadas
// por customTag.
class XtbSession {
  private socket: WebSocket | null = null;
  private ping: NodeJS.Timeout | null = null;
  private idle: NodeJS.Timeout | null = null;
  private lastCommandAt = 0;
  private counter = 0;
  private readonly pending = new Map<
    string,
    {
      command: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
  ) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      const timer = setTimeout(() => {
        socket.terminate();
        reject(
          new BadGatewayException('XTB no respondió al abrir la conexión'),
        );
      }, CONNECT_TIMEOUT_MS);

      socket.on('open', () => {
        clearTimeout(timer);
        this.startKeepAlive();
        resolve();
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new BadGatewayException(
            `No se pudo conectar con XTB: ${error.message}`,
          ),
        );
      });
      socket.on('message', (data) => this.onMessage(data.toString()));
      socket.on('close', () =>
        this.failPending('La conexión con XTB se cerró'),
      );
    });
  }

  async login(userId: string, password: string): Promise<void> {
    // userId y password solo se usan aquí; no se guardan en ningún campo
    await this.command('login', { userId, password });
  }

  async command<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new BadGatewayException('La conexión con XTB no está abierta');
    }
    // el protocolo exige separación mínima entre comandos
    const since = Date.now() - this.lastCommandAt;
    if (since < COMMAND_GAP_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, COMMAND_GAP_MS - since),
      );
    }

    this.counter += 1;
    const customTag = `cmd-${this.counter}`;
    const payload = JSON.stringify({
      command: name,
      arguments: args,
      customTag,
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(customTag);
        reject(
          new BadGatewayException(`XTB no respondió al comando "${name}"`),
        );
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(customTag, {
        command: name,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket!.send(payload);
      this.lastCommandAt = Date.now();
      this.resetIdle();
    });
  }

  close(): void {
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = null;
    }
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    this.failPending('Sesión de XTB cerrada');
    this.socket?.close();
    this.socket = null;
  }

  private onMessage(raw: string): void {
    let message: {
      status?: boolean;
      returnData?: unknown;
      customTag?: string;
      errorDescr?: string;
      errorCode?: string;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const tag = message.customTag;
    if (!tag) {
      return;
    }
    const waiter = this.pending.get(tag);
    if (!waiter) {
      return;
    }
    this.pending.delete(tag);
    if (message.status === false) {
      // el nombre del comando va en el mensaje: sin él, un "Invalid parameters"
      // no dice nada sobre qué falló
      const detalle =
        message.errorDescr ?? message.errorCode ?? 'error desconocido';

      // Un EX017 no es un problema de credenciales: es que el endpoint que
      // habla este conector no sirve cuentas minoristas de XTB. Decirle al
      // usuario "revisa tu contraseña" lo manda a perseguir algo que no falla.
      if (message.errorCode === WRONG_PLATFORM_CODE) {
        waiter.reject(
          new BadGatewayException(
            'XTB no acepta esta cuenta por su API: retiró el acceso público ' +
              '(ws.xtb.com ya no responde) y el endpoint que queda sirve a otra ' +
              'plataforma. No es un problema de tus credenciales y no se ' +
              'arregla cambiándolas. Importa tu statement de XTB en CSV o XLSX ' +
              'desde /investments/import, que sí funciona.',
          ),
        );
        return;
      }

      waiter.reject(
        new BadGatewayException(
          `XTB rechazó el comando "${waiter.command}": ${detalle}` +
            (message.errorCode ? ` (${message.errorCode})` : ''),
        ),
      );
      return;
    }
    waiter.resolve(message.returnData);
  }

  private startKeepAlive(): void {
    this.ping = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ command: 'ping' }));
      }
    }, PING_INTERVAL_MS);
    this.resetIdle();
  }

  private resetIdle(): void {
    if (this.idle) {
      clearTimeout(this.idle);
    }
    // cierre duro si la sesión se queda inactiva: no dejamos una sesión de
    // trading abierta colgando
    this.idle = setTimeout(() => {
      this.logger.debug('Sesión de XTB cerrada por inactividad');
      this.close();
    }, IDLE_CLOSE_MS);
  }

  private failPending(reason: string): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(new BadGatewayException(reason));
    }
    this.pending.clear();
  }
}

interface XtbTrade {
  symbol?: string;
  cmd?: number;
  volume?: number;
  open_price?: number;
  close_price?: number;
  open_time?: number;
  close_time?: number;
  commission?: number;
  position?: number;
  order?: number;
  customComment?: string | null;
}

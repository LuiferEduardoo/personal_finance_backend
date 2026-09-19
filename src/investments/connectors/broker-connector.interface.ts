import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';

// Credenciales de un bróker, ya descifradas.
//
// toJSON() devuelve '[redacted]' a propósito: basta un console.log o un
// logger que serialice el objeto para filtrar una contraseña de trading. Esto
// lo corta de raíz.
export class BrokerCredentials {
  constructor(private readonly values: Record<string, unknown>) {}

  get<T = string>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }

  require(key: string): string {
    const value = this.values[key];
    if (typeof value !== 'string' || !value) {
      throw new Error(`Falta la credencial "${key}"`);
    }
    return value;
  }

  toJSON(): string {
    return '[redacted]';
  }

  toString(): string {
    return '[redacted]';
  }
}

export interface BrokerIdentity {
  /** identificador de la cuenta en el bróker */
  accountId: string | null;
  displayName: string | null;
  currency: string | null;
}

export interface RawAccount {
  externalId: string;
  name: string;
  currency: string;
}

export interface RawPosition {
  symbolHint: string;
  quantity: number;
  currency: string | null;
}

// Forma YA NORMALIZADA. Los conectores traducen de su bróker a esto; el
// servicio de sincronización traduce de esto a entidades. Esa frontera es lo
// único que impide que cuatro APIs muy distintas se filtren al libro.
export interface RawTransaction {
  type: InvestmentTransactionType;
  occurredOn: string;
  occurredAt: Date | null;
  symbolHint: string | null;
  exchangeHint: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  settlementCurrency: string | null;
  settlementAmount: number | null;
  externalId: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

export interface SyncCursor {
  [key: string]: unknown;
}

export interface AccountRef {
  externalId: string | null;
  currency: string;
  /**
   * Activos que el usuario YA ha operado en esta cuenta, según su libro.
   *
   * Hace falta para Binance: su API exige un símbolo por consulta y no hay
   * forma de pedir "todas mis operaciones". Si los candidatos se construyen
   * solo desde el saldo actual, un activo que vendiste entero desaparece del
   * conjunto y su histórico no se trae nunca.
   */
  knownSymbols?: string[];
}

export interface FetchResult {
  rows: RawTransaction[];
  cursor: SyncCursor;
  /** true si no se pudo traer todo el periodo pedido */
  partial: boolean;
  warnings: string[];
}

export interface BrokerConnector {
  readonly broker: BrokerKind;
  verifyCredentials(creds: BrokerCredentials): Promise<BrokerIdentity>;
  fetchAccounts(creds: BrokerCredentials): Promise<RawAccount[]>;
  fetchPositions(
    creds: BrokerCredentials,
    account: AccountRef,
  ): Promise<RawPosition[]>;
  fetchTransactions(
    creds: BrokerCredentials,
    account: AccountRef,
    cursor: SyncCursor | null,
  ): Promise<FetchResult>;
}

// ¿El fallo es "hay que volver a autenticarse" o "algo puntual salió mal"?
//
// Distinguirlo importa: NEEDS_REAUTH le dice al usuario que vaya a regenerar
// sus credenciales, mientras que ERROR es un problema que puede resolverse
// solo en el siguiente intento. Cada bróker lo expresa a su manera, así que se
// reconoce por patrón y se mantiene en UN solo sitio.
const REAUTH_PATTERNS =
  /token|credencial|credential|rechaz|401|403|unauthor|invalid login|invalid password|password|api-key|apikey|permission|forbidden|expired/i;

export function needsReauth(message: string): boolean {
  return REAUTH_PATTERNS.test(message);
}

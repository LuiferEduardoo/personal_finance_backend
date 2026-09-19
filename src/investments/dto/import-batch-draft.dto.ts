import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';

// DTOs planos (no @ObjectType): la importación va por REST con multer, igual
// que el análisis de facturas, no por GraphQL.

export interface InvestmentTransactionDraft {
  /** fila del archivo, 1-indexada sin contar la cabecera */
  rowNumber: number;
  type: InvestmentTransactionType | null;
  occurredOn: string | null;
  occurredAt: string | null;
  symbol: string | null;
  isin: string | null;
  instrumentId: string | null;
  /** true cuando no se pudo resolver el instrumento y el usuario debe elegirlo */
  needsInstrument: boolean;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number;
  tax: number;
  currency: string | null;
  externalId: string | null;
  notes: string | null;
  /**
   * true si esta operación ya está en el libro. Se marca EN EL BORRADOR, antes
   * de confirmar, para que el usuario vea lo que se va a saltar.
   */
  isDuplicate: boolean;
  /** motivos por los que la fila no se puede importar tal cual */
  errors: string[];
  /** la fila original, para que el usuario pueda cotejar */
  raw: Record<string, string>;
}

export interface ImportBatchStats {
  totalRows: number;
  importable: number;
  duplicates: number;
  withErrors: number;
  needingInstrument: number;
}

export interface ImportBatchDraft {
  batchId: string;
  fileName: string | null;
  detectedProfile: string;
  detectedBroker: string;
  confidence: number;
  /** campo canónico -> cabecera real; se puede corregir al confirmar */
  columnMapping: Record<string, string>;
  headers: string[];
  sheetName: string | null;
  stats: ImportBatchStats;
  rows: InvestmentTransactionDraft[];
}

export interface ImportCommitResult {
  batchId: string;
  inserted: number;
  skippedDuplicates: number;
  skippedErrors: number;
  alreadyCommitted: boolean;
}

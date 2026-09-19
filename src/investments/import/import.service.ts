import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { assertCurrency } from '../../common/currency';
import {
  INSTRUMENT_REQUIRED_TYPES,
  InvestmentTransactionType,
} from '../../common/enums/investment-transaction-type.enum';
import { InstrumentsService } from '../../market-data/instruments.service';
import { PricesService } from '../../market-data/prices.service';
import { roundMoney, roundQuantity } from '../analytics/money';
import { dedupeHash } from '../dedupe';
import {
  ImportBatchDraft,
  ImportBatchStats,
  ImportCommitResult,
  InvestmentTransactionDraft,
} from '../dto/import-batch-draft.dto';
import {
  ImportBatch,
  ImportSource,
  ImportStatus,
} from '../entities/import-batch.entity';
import { InvestmentTransaction } from '../entities/investment-transaction.entity';
import { InvestmentAccountsService } from '../investment-accounts.service';
import { PositionsService } from '../positions.service';
import { PdfStatementService } from './pdf-statement.service';
import { ProfileRegistry } from './profile-registry';
import { ParserProfile, normalizeHeader } from './profiles/profile.types';
import {
  SpreadsheetParserService,
  parseDate,
  parseNumber,
} from './spreadsheet-parser.service';

// Orquesta el flujo detectar -> extraer -> mapear -> normalizar -> borrador ->
// revisar -> confirmar, copiando la forma del análisis de facturas: el archivo
// crudo se archiva, el resultado va a un borrador, y persistir es un paso
// aparte que el usuario confirma.
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    @InjectRepository(ImportBatch)
    private readonly batchesRepository: Repository<ImportBatch>,
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    private readonly parser: SpreadsheetParserService,
    private readonly registry: ProfileRegistry,
    private readonly pdfService: PdfStatementService,
    private readonly instrumentsService: InstrumentsService,
    private readonly accountsService: InvestmentAccountsService,
    private readonly positionsService: PositionsService,
    private readonly pricesService: PricesService,
    private readonly dataSource: DataSource,
  ) {}

  // --- paso 1: analizar ---

  async analyze(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    accountId?: string,
  ): Promise<ImportBatchDraft> {
    if (accountId) {
      await this.accountsService.assertOwned(accountId, userId);
    }
    // el PDF tiene su propio extractor, pero desemboca en el MISMO borrador:
    // no hay un camino paralelo con reglas propias
    if (this.isPdf(file.originalname, file.mimetype)) {
      return this.analyzePdf(userId, file, accountId);
    }

    const table = await this.parser.parse(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    const detection = this.registry.detect(table.headers);
    const source = /\.xlsx?$/i.test(file.originalname)
      ? ImportSource.XLSX
      : ImportSource.CSV;

    const rows = await this.buildRows(
      userId,
      table.rows,
      detection.profile,
      detection.mapping,
      accountId,
    );
    const stats = this.summarize(rows);

    const batch = await this.batchesRepository.save(
      this.batchesRepository.create({
        userId,
        accountId: accountId ?? null,
        source,
        status: ImportStatus.PARSED,
        broker: detection.profile.broker,
        fileName: file.originalname,
        fileData: file.buffer,
        fileMimeType: file.mimetype,
        parserProfile: detection.profile.id,
        columnMapping: detection.mapping,
        draft: rows,
        stats: stats as unknown as Record<string, number>,
      }),
    );

    return {
      batchId: batch.id,
      fileName: file.originalname,
      detectedProfile: detection.profile.id,
      detectedBroker: detection.profile.broker,
      confidence: detection.confidence,
      columnMapping: detection.mapping,
      headers: table.headers,
      sheetName: table.sheetName,
      stats,
      rows,
    };
  }

  private isPdf(fileName: string, mimeType: string): boolean {
    return /\.pdf$/i.test(fileName) || mimeType === 'application/pdf';
  }

  private async analyzePdf(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    accountId?: string,
  ): Promise<ImportBatchDraft> {
    const extracted = await this.pdfService.extractTransactions(file.buffer);

    // resolución de instrumento y deduplicación: exactamente las mismas que en
    // CSV y XLSX
    const symbolCache = new Map<string, string | null>();
    for (const row of extracted.rows) {
      if (!row.type || !INSTRUMENT_REQUIRED_TYPES.includes(row.type)) {
        continue;
      }
      const hint = row.symbol ?? row.isin;
      if (!hint) {
        row.needsInstrument = true;
        row.errors.push(
          'La operación necesita un instrumento y no se identificó',
        );
        continue;
      }
      row.instrumentId = await this.resolveSymbol(hint, symbolCache);
      row.needsInstrument = row.instrumentId === null;
      if (row.quantity === null || row.quantity <= 0) {
        row.errors.push('La operación necesita una cantidad mayor que 0');
      }
    }
    // y también las que no exigen instrumento pero sí traen símbolo
    for (const row of extracted.rows) {
      if (!row.instrumentId && (row.symbol || row.isin)) {
        row.instrumentId = await this.resolveSymbol(
          (row.symbol ?? row.isin)!,
          symbolCache,
        );
      }
    }
    await this.markDuplicates(userId, extracted.rows, accountId);
    const stats = this.summarize(extracted.rows);

    const batch = await this.batchesRepository.save(
      this.batchesRepository.create({
        userId,
        accountId: accountId ?? null,
        source: ImportSource.PDF,
        status: ImportStatus.PARSED,
        broker: null,
        fileName: file.originalname,
        // el PDF no se re-parsea con otro mapeo: no hay columnas que remapear,
        // así que guardarlo solo ocuparía espacio
        fileData: null,
        fileMimeType: file.mimetype,
        parserProfile: 'pdf-llm',
        columnMapping: null,
        draft: extracted.rows,
        stats: stats as unknown as Record<string, number>,
      }),
    );

    return {
      batchId: batch.id,
      fileName: file.originalname,
      detectedProfile: 'pdf-llm',
      detectedBroker: 'manual',
      confidence: 0,
      columnMapping: {},
      headers: [],
      sheetName: null,
      stats,
      rows: extracted.rows,
    };
  }

  // Vuelve a parsear el archivo archivado con otro mapeo de columnas. Esta es
  // toda la historia del "mapeo definido por el usuario": el usuario corrige el
  // mapeo que el parser adivinó, sin tener que volver a subir nada.
  async remap(
    userId: string,
    batchId: string,
    columnMapping: Record<string, string>,
    profileId?: string,
  ): Promise<ImportBatchDraft> {
    const batch = await this.findBatch(batchId, userId);
    if (!batch.fileData) {
      throw new BadRequestException(
        'El lote no conserva el archivo original; vuelve a subirlo',
      );
    }
    const profile = this.registry.byId(profileId ?? batch.parserProfile ?? '');
    const table = await this.parser.parse(
      batch.fileData,
      batch.fileName ?? 'import.csv',
      batch.fileMimeType ?? 'text/csv',
    );
    const rows = await this.buildRows(
      userId,
      table.rows,
      profile,
      columnMapping,
      batch.accountId ?? undefined,
    );
    const stats = this.summarize(rows);

    batch.columnMapping = columnMapping;
    batch.parserProfile = profile.id;
    batch.draft = rows;
    batch.stats = stats as unknown as Record<string, number>;
    await this.batchesRepository.save(batch);

    return {
      batchId: batch.id,
      fileName: batch.fileName,
      detectedProfile: profile.id,
      detectedBroker: profile.broker,
      confidence: 1,
      columnMapping,
      headers: table.headers,
      sheetName: table.sheetName,
      stats,
      rows,
    };
  }

  // --- paso 2: confirmar ---

  async commit(
    userId: string,
    batchId: string,
    accountId: string,
    rows?: InvestmentTransactionDraft[],
  ): Promise<ImportCommitResult> {
    const batch = await this.findBatch(batchId, userId);

    // confirmar dos veces el mismo lote no duplica nada: devuelve lo que ya
    // pasó. La importación tiene que ser idempotente de extremo a extremo.
    if (batch.status === ImportStatus.COMMITTED) {
      return {
        batchId: batch.id,
        inserted: batch.stats?.inserted ?? 0,
        skippedDuplicates: batch.stats?.duplicates ?? 0,
        skippedErrors: batch.stats?.withErrors ?? 0,
        alreadyCommitted: true,
      };
    }
    if (batch.status === ImportStatus.DISCARDED) {
      throw new BadRequestException('El lote fue descartado');
    }

    await this.accountsService.assertOwned(accountId, userId);
    const draft = (rows ??
      (batch.draft as InvestmentTransactionDraft[] | null) ??
      []) as InvestmentTransactionDraft[];

    const importable = draft.filter(
      (row) =>
        row.errors.length === 0 && !row.isDuplicate && !row.needsInstrument,
    );
    const skippedErrors = draft.filter(
      (row) => row.errors.length > 0 || row.needsInstrument,
    ).length;
    const skippedDuplicates = draft.filter((row) => row.isDuplicate).length;

    let inserted = 0;
    if (importable.length > 0) {
      const values = importable.map((row) =>
        this.toEntity(userId, accountId, batch.id, row),
      );
      await this.dataSource.transaction(async (manager) => {
        // orIgnore + el índice único de deduplicación: si dos filas del mismo
        // archivo colisionan, la base las resuelve sin carrera.
        const result = await manager
          .createQueryBuilder()
          .insert()
          .into(InvestmentTransaction)
          .values(values)
          .orIgnore()
          .returning('id')
          .execute();
        inserted = result.raw?.length ?? 0;
        await this.positionsService.rebuild(userId, [accountId], manager);
      });

      // el histórico de precios de los instrumentos nuevos, sin bloquear
      const instrumentIds = [
        ...new Set(
          importable
            .map((row) => row.instrumentId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const earliest = importable
        .map((row) => row.occurredOn)
        .filter((date): date is string => Boolean(date))
        .sort()[0];
      if (earliest) {
        for (const instrumentId of instrumentIds) {
          await this.pricesService.requestBackfill(instrumentId, earliest);
        }
      }
    }

    batch.status = ImportStatus.COMMITTED;
    batch.accountId = accountId;
    batch.stats = {
      ...(batch.stats ?? {}),
      inserted,
      duplicates: skippedDuplicates,
      withErrors: skippedErrors,
    };
    // el archivo ya no hace falta una vez confirmado
    batch.fileData = null;
    await this.batchesRepository.save(batch);

    return {
      batchId: batch.id,
      inserted,
      skippedDuplicates,
      skippedErrors,
      alreadyCommitted: false,
    };
  }

  async discard(userId: string, batchId: string): Promise<boolean> {
    const batch = await this.findBatch(batchId, userId);
    if (batch.status === ImportStatus.COMMITTED) {
      throw new BadRequestException(
        'El lote ya se confirmó; borra las operaciones si quieres deshacerlo',
      );
    }
    batch.status = ImportStatus.DISCARDED;
    batch.fileData = null;
    batch.draft = null;
    await this.batchesRepository.save(batch);
    return true;
  }

  findBatches(userId: string, limit = 50): Promise<ImportBatch[]> {
    return this.batchesRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  async findBatch(batchId: string, userId: string): Promise<ImportBatch> {
    const batch = await this.batchesRepository.findOne({
      where: { id: batchId, userId },
    });
    if (!batch) {
      throw new NotFoundException(
        `Lote de importación ${batchId} no encontrado`,
      );
    }
    return batch;
  }

  async batchDraft(
    userId: string,
    batchId: string,
  ): Promise<InvestmentTransactionDraft[]> {
    const batch = await this.findBatch(batchId, userId);
    return (batch.draft as InvestmentTransactionDraft[] | null) ?? [];
  }

  // --- construcción del borrador ---

  private async buildRows(
    userId: string,
    raw: Record<string, string>[],
    profile: ParserProfile,
    mapping: Record<string, string>,
    accountId?: string,
  ): Promise<InvestmentTransactionDraft[]> {
    const rows: InvestmentTransactionDraft[] = [];
    const symbolCache = new Map<string, string | null>();

    for (let i = 0; i < raw.length; i += 1) {
      rows.push(
        await this.buildRow(raw[i], i + 1, profile, mapping, symbolCache),
      );
    }

    await this.markDuplicates(userId, rows, accountId);
    return rows;
  }

  private async buildRow(
    raw: Record<string, string>,
    rowNumber: number,
    profile: ParserProfile,
    mapping: Record<string, string>,
    symbolCache: Map<string, string | null>,
  ): Promise<InvestmentTransactionDraft> {
    const get = (field: string): string | undefined => {
      const header = mapping[field];
      return header ? raw[header] : undefined;
    };
    const errors: string[] = [];

    const occurredOn = parseDate(get('occurredOn'), profile);
    if (!occurredOn) {
      errors.push('No se pudo leer la fecha');
    }

    const type = this.mapType(get('type'), profile);
    if (!type) {
      const rawType = get('type');
      errors.push(
        rawType
          ? `Tipo de operación no reconocido: "${rawType}"`
          : 'Falta el tipo de operación',
      );
    }

    const quantity = parseNumber(get('quantity'), profile);
    const price = parseNumber(get('price'), profile);
    let amount = parseNumber(get('amount'), profile);
    const fee = Math.abs(parseNumber(get('fee'), profile) ?? 0);
    const tax = Math.abs(parseNumber(get('tax'), profile) ?? 0);

    // los importes se guardan siempre como magnitud positiva; la dirección la
    // marca el tipo. Un bróker que exporta las ventas en negativo no debe
    // meter signos en el libro.
    if (amount !== null) {
      amount = Math.abs(amount);
    }
    if (amount === null && quantity !== null && price !== null) {
      amount = roundMoney(Math.abs(quantity) * Math.abs(price));
    }

    const symbol = (get('symbol') ?? '').trim() || null;
    const isin = (get('isin') ?? '').trim() || null;
    let instrumentId: string | null = null;
    let needsInstrument = false;

    // se resuelve el instrumento SIEMPRE que la fila traiga símbolo, no solo
    // cuando la operación lo exige: así un dividendo o una comisión quedan
    // atribuidos a su activo y cuentan en "rendimiento por activo"
    if (symbol || isin) {
      instrumentId = await this.resolveSymbol(symbol ?? isin!, symbolCache);
    }
    if (type && INSTRUMENT_REQUIRED_TYPES.includes(type)) {
      if (!symbol && !isin) {
        needsInstrument = true;
        errors.push(
          'La operación necesita un instrumento y la fila no lo trae',
        );
      } else {
        // solo bloquea cuando el instrumento es obligatorio y no se resolvió
        needsInstrument = instrumentId === null;
      }
      if (quantity === null || quantity <= 0) {
        errors.push('La operación necesita una cantidad mayor que 0');
      }
    }

    let currency: string | null = null;
    const rawCurrency = (get('currency') ?? '').trim();
    if (rawCurrency) {
      try {
        currency = assertCurrency(rawCurrency);
      } catch {
        errors.push(`Moneda no reconocida: "${rawCurrency}"`);
      }
    }

    return {
      rowNumber,
      type,
      occurredOn,
      occurredAt: null,
      symbol,
      isin,
      instrumentId,
      needsInstrument,
      quantity: quantity === null ? null : roundQuantity(Math.abs(quantity)),
      price: price === null ? null : Math.abs(price),
      amount,
      fee,
      tax,
      currency,
      externalId: (get('externalId') ?? '').trim() || null,
      notes: (get('notes') ?? '').trim() || null,
      isDuplicate: false,
      errors,
      raw,
    };
  }

  private mapType(
    rawType: string | undefined,
    profile: ParserProfile,
  ): InvestmentTransactionType | null {
    if (!rawType) {
      return null;
    }
    const normalized = normalizeHeader(rawType);
    for (const [key, value] of Object.entries(profile.typeMap)) {
      if (normalizeHeader(key) === normalized) {
        return value;
      }
    }
    // el propio nombre del enum, por si el archivo ya viene en nuestro formato
    const direct = Object.values(InvestmentTransactionType).find(
      (value) => normalizeHeader(value) === normalized,
    );
    return direct ?? null;
  }

  private async resolveSymbol(
    hint: string,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    const key = hint.trim().toUpperCase();
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    // el símbolo del bróker suele traer sufijos: "AAPL.US", "AAPL/USD"
    const candidates = [key, key.split(/[./]/)[0]];
    let found: string | null = null;
    for (const candidate of candidates) {
      const matches = await this.instrumentsService.search(candidate, 5);
      const exact = matches.find(
        (instrument) => instrument.symbol.toUpperCase() === candidate,
      );
      if (exact) {
        found = exact.id;
        break;
      }
    }
    cache.set(key, found);
    return found;
  }

  // Marca los duplicados EN EL BORRADOR, calculando el hash y consultando el
  // índice único. Así el usuario ve qué se va a saltar ANTES de confirmar, en
  // vez de descubrirlo después.
  private async markDuplicates(
    userId: string,
    rows: InvestmentTransactionDraft[],
    accountId?: string,
  ): Promise<void> {
    if (!accountId) {
      return;
    }
    const hashes = new Map<string, InvestmentTransactionDraft[]>();
    for (const row of rows) {
      if (row.errors.length > 0 || !row.type || !row.occurredOn) {
        continue;
      }
      const hash = dedupeHash({
        userId,
        accountId,
        type: row.type,
        occurredOn: row.occurredOn,
        instrumentId: row.instrumentId,
        quantity: row.quantity,
        amount: row.amount ?? 0,
        currency: row.currency ?? 'USD',
        occurrenceIndex: 0,
      });
      const bucket = hashes.get(hash) ?? [];
      bucket.push(row);
      hashes.set(hash, bucket);
    }
    if (hashes.size === 0) {
      return;
    }

    const existing = await this.transactionsRepository.find({
      where: { userId, dedupeHash: In([...hashes.keys()]) },
      select: { dedupeHash: true },
    });
    const known = new Set(existing.map((row) => row.dedupeHash));

    for (const [hash, bucket] of hashes.entries()) {
      // ya está en el libro
      if (known.has(hash)) {
        bucket.forEach((row) => {
          row.isDuplicate = true;
        });
        continue;
      }
      // duplicados DENTRO del mismo archivo: la primera entra, las demás se
      // marcan. Si de verdad son operaciones repetidas, el usuario las
      // desmarca y se distinguen con occurrenceIndex.
      bucket.slice(1).forEach((row) => {
        row.isDuplicate = true;
      });
    }
  }

  private summarize(rows: InvestmentTransactionDraft[]): ImportBatchStats {
    return {
      totalRows: rows.length,
      importable: rows.filter(
        (row) =>
          row.errors.length === 0 && !row.isDuplicate && !row.needsInstrument,
      ).length,
      duplicates: rows.filter((row) => row.isDuplicate).length,
      withErrors: rows.filter((row) => row.errors.length > 0).length,
      needingInstrument: rows.filter((row) => row.needsInstrument).length,
    };
  }

  private toEntity(
    userId: string,
    accountId: string,
    batchId: string,
    row: InvestmentTransactionDraft,
  ): Partial<InvestmentTransaction> {
    const currency = row.currency ?? 'USD';
    const amount = roundMoney(row.amount ?? 0);
    return {
      userId,
      accountId,
      type: row.type!,
      instrumentId: row.instrumentId,
      occurredOn: row.occurredOn!,
      quantity: row.quantity,
      price: row.price,
      amount,
      fee: roundMoney(row.fee),
      tax: roundMoney(row.tax),
      currency,
      notes: row.notes,
      externalId: row.externalId,
      importBatchId: batchId,
      occurrenceIndex: 0,
      raw: row.raw,
      dedupeHash: dedupeHash({
        userId,
        accountId,
        type: row.type!,
        occurredOn: row.occurredOn!,
        instrumentId: row.instrumentId,
        quantity: row.quantity,
        amount,
        currency,
        occurrenceIndex: 0,
      }),
    };
  }
}

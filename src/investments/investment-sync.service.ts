import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertCurrency } from '../common/currency';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { FxService } from '../market-data/fx.service';
import { InstrumentsService } from '../market-data/instruments.service';
import { PricesService } from '../market-data/prices.service';
import { roundMoney, roundQuantity } from './analytics/money';
import { BrokerConnectionsService } from './broker-connections.service';
import {
  RawTransaction,
  needsReauth,
} from './connectors/broker-connector.interface';
import { BrokerConnectorRegistry } from './connectors/connector.registry';
import { dedupeHash } from './dedupe';
import {
  BrokerConnection,
  BrokerConnectionStatus,
} from './entities/broker-connection.entity';
import {
  ImportBatch,
  ImportSource,
  ImportStatus,
} from './entities/import-batch.entity';
import { InvestmentAccount } from './entities/investment-account.entity';
import {
  FxRateSource,
  InvestmentTransaction,
} from './entities/investment-transaction.entity';
import { User } from '../users/entities/user.entity';
import { PositionsService } from './positions.service';

export interface SyncReport {
  connectionId: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  errors: string[];
  warnings: string[];
  partial: boolean;
}

@Injectable()
export class InvestmentSyncService {
  private readonly logger = new Logger(InvestmentSyncService.name);

  constructor(
    @InjectRepository(InvestmentTransaction)
    private readonly transactionsRepository: Repository<InvestmentTransaction>,
    @InjectRepository(InvestmentAccount)
    private readonly accountsRepository: Repository<InvestmentAccount>,
    @InjectRepository(ImportBatch)
    private readonly batchesRepository: Repository<ImportBatch>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly connectionsService: BrokerConnectionsService,
    private readonly registry: BrokerConnectorRegistry,
    private readonly instrumentsService: InstrumentsService,
    private readonly positionsService: PositionsService,
    private readonly pricesService: PricesService,
    private readonly fxService: FxService,
    private readonly dataSource: DataSource,
  ) {}

  // Sincroniza TODAS las conexiones del usuario. Una que falle no aborta las
  // demás: cada una registra su propio error.
  async syncAll(userId: string, onlyAutoSync = false): Promise<SyncReport[]> {
    const connections = await this.connectionsService.findAll(userId);
    const reports: SyncReport[] = [];
    for (const connection of connections) {
      if (connection.status === BrokerConnectionStatus.DISABLED) {
        continue;
      }
      if (onlyAutoSync && !connection.autoSync) {
        continue;
      }
      reports.push(await this.sync(userId, connection.id));
    }
    return reports;
  }

  async sync(userId: string, connectionId: string): Promise<SyncReport> {
    const connection = await this.connectionsService.findOne(
      connectionId,
      userId,
    );
    const report: SyncReport = {
      connectionId,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      errors: [],
      warnings: [],
      partial: false,
    };

    try {
      const connector = this.registry.get(connection.broker);
      // las credenciales se descifran aquí y se pasan directas al conector;
      // no se guardan en ningún sitio
      const credentials = this.connectionsService.credentialsOf(connection);

      const brokerAccounts = await connector.fetchAccounts(credentials);
      for (const brokerAccount of brokerAccounts) {
        const account = await this.ensureAccount(
          userId,
          connection,
          brokerAccount,
        );
        const result = await connector.fetchTransactions(
          credentials,
          {
            externalId: brokerAccount.externalId,
            currency: account.currency,
            knownSymbols: await this.tradedSymbols(userId, account.id),
          },
          connection.lastSyncCursor,
        );

        report.fetched += result.rows.length;
        report.warnings.push(...result.warnings);
        report.partial = report.partial || result.partial;

        const persisted = await this.persist(userId, account, result.rows);
        report.inserted += persisted.inserted;
        report.duplicates += persisted.duplicates;

        await this.connectionsService.setCursor(connection.id, result.cursor);
      }

      await this.connectionsService.setStatus(
        connection.id,
        BrokerConnectionStatus.ACTIVE,
        null,
      );
    } catch (error) {
      const message = (error as Error).message;
      report.errors.push(message);
      await this.connectionsService.setStatus(
        connection.id,
        needsReauth(message)
          ? BrokerConnectionStatus.NEEDS_REAUTH
          : BrokerConnectionStatus.ERROR,
        message,
      );
      this.logger.error(`Fallo sincronizando ${connection.broker}: ${message}`);
    }

    // cada sincronización deja su rastro en import_batches: el historial de
    // sincronizaciones sale gratis y con la misma forma que las importaciones
    await this.batchesRepository.save(
      this.batchesRepository.create({
        userId,
        connectionId: connection.id,
        source: ImportSource.BROKER_SYNC,
        status:
          report.errors.length > 0
            ? ImportStatus.FAILED
            : ImportStatus.COMMITTED,
        broker: connection.broker,
        parserProfile: `${connection.broker}-connector`,
        stats: {
          fetched: report.fetched,
          inserted: report.inserted,
          duplicates: report.duplicates,
          errors: report.errors.length,
        },
        error: report.errors.join('; ') || null,
      }),
    );

    return report;
  }

  // Activos que el usuario ya ha operado en esta cuenta. Se los pasamos al
  // conector para que no dependa solo del saldo actual: un activo vendido por
  // completo tiene saldo cero y aun así su histórico debe poder traerse.
  private async tradedSymbols(
    userId: string,
    accountId: string,
  ): Promise<string[]> {
    const rows: { symbol: string }[] = await this.transactionsRepository.query(
      `
        SELECT DISTINCT i."symbol"
        FROM "investment_transactions" t
        JOIN "instruments" i ON i."id" = t."instrument_id"
        WHERE t."user_id" = $1 AND t."account_id" = $2
      `,
      [userId, accountId],
    );
    return rows.map((row) => row.symbol);
  }

  private async ensureAccount(
    userId: string,
    connection: BrokerConnection,
    brokerAccount: { externalId: string; name: string; currency: string },
  ): Promise<InvestmentAccount> {
    const existing = await this.accountsRepository.findOne({
      where: {
        userId,
        connectionId: connection.id,
        externalAccountId: brokerAccount.externalId,
      },
    });
    if (existing) {
      return existing;
    }
    return this.accountsRepository.save(
      this.accountsRepository.create({
        userId,
        connectionId: connection.id,
        broker: connection.broker,
        externalAccountId: brokerAccount.externalId,
        name: `${brokerAccount.name}${connection.isDemo ? ' (demo)' : ''}`,
        currency: this.safeCurrency(brokerAccount.currency),
      }),
    );
  }

  // Inserta con orIgnore contra el índice único de deduplicación: si la misma
  // operación ya está, la base la descarta sin carrera. Por eso resincronizar
  // un periodo solapado es gratis.
  private async persist(
    userId: string,
    account: InvestmentAccount,
    rows: RawTransaction[],
  ): Promise<{ inserted: number; duplicates: number }> {
    if (rows.length === 0) {
      return { inserted: 0, duplicates: 0 };
    }

    const baseCurrency = await this.baseCurrency(userId);
    const values: Partial<InvestmentTransaction>[] = [];

    for (const row of rows) {
      const entity = await this.toEntity(userId, account, row, baseCurrency);
      if (entity) {
        values.push(entity);
      }
    }
    if (values.length === 0) {
      return { inserted: 0, duplicates: 0 };
    }

    let inserted = 0;
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(InvestmentTransaction)
        .values(values)
        .orIgnore()
        .returning('id')
        .execute();
      inserted = result.raw?.length ?? 0;
      await this.positionsService.rebuild(userId, [account.id], manager);
    });

    // histórico de precios de lo que entró nuevo, sin bloquear
    const instrumentIds = [
      ...new Set(
        values
          .map((value) => value.instrumentId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const earliest = values
      .map((value) => value.occurredOn!)
      .filter(Boolean)
      .sort()[0];
    if (earliest) {
      for (const instrumentId of instrumentIds) {
        await this.pricesService.requestBackfill(instrumentId, earliest);
      }
    }

    return { inserted, duplicates: values.length - inserted };
  }

  private async toEntity(
    userId: string,
    account: InvestmentAccount,
    row: RawTransaction,
    baseCurrency: string,
  ): Promise<Partial<InvestmentTransaction> | null> {
    const currency = this.safeCurrency(row.currency);
    const amount = roundMoney(Math.abs(row.amount));
    const quantity =
      row.quantity === null ? null : roundQuantity(Math.abs(row.quantity));

    let instrumentId: string | null = null;
    if (row.symbolHint) {
      const instrument = await this.instrumentsService.resolveOrCreate(
        row.symbolHint,
        {
          exchange: row.exchangeHint,
          currency,
          name: row.symbolHint,
        },
      );
      instrumentId = instrument.id;
    }

    // las operaciones que exigen instrumento y no lo tienen se descartan en
    // vez de entrar rotas al libro
    if (
      [
        InvestmentTransactionType.BUY,
        InvestmentTransactionType.SELL,
        InvestmentTransactionType.SPLIT,
        InvestmentTransactionType.TRANSFER_IN,
        InvestmentTransactionType.TRANSFER_OUT,
      ].includes(row.type) &&
      (!instrumentId || !quantity)
    ) {
      return null;
    }
    if (amount <= 0 && row.type !== InvestmentTransactionType.SPLIT) {
      return null;
    }

    const fxRate = await this.fxService.rateForWrite(
      currency,
      baseCurrency,
      row.occurredOn,
    );

    return {
      userId,
      accountId: account.id,
      connectionId: account.connectionId,
      type: row.type,
      instrumentId,
      occurredOn: row.occurredOn,
      occurredAt: row.occurredAt,
      quantity,
      price: row.price === null ? null : Math.abs(row.price),
      amount,
      fee: roundMoney(Math.abs(row.fee)),
      tax: roundMoney(Math.abs(row.tax)),
      currency,
      fxRate,
      fxRateSource:
        fxRate === 1 ? FxRateSource.ASSUMED_ONE : FxRateSource.TWELVE_DATA,
      settlementCurrency: row.settlementCurrency,
      settlementAmount: row.settlementAmount,
      externalId: row.externalId,
      notes: row.notes,
      occurrenceIndex: 0,
      raw: row.raw,
      dedupeHash: dedupeHash({
        userId,
        accountId: account.id,
        type: row.type,
        occurredOn: row.occurredOn,
        instrumentId,
        quantity,
        amount,
        currency,
        occurrenceIndex: 0,
      }),
    };
  }

  private async baseCurrency(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    return user?.baseCurrency ?? 'USD';
  }

  // los brókers mandan códigos raros; uno inválido no debe tumbar la
  // sincronización entera
  private safeCurrency(value: string | null | undefined): string {
    try {
      return assertCurrency(value ?? 'USD');
    } catch {
      return 'USD';
    }
  }

  async usersWithAutoSync(): Promise<string[]> {
    const rows: { user_id: string }[] = await this.transactionsRepository.query(
      `SELECT DISTINCT "user_id" FROM "broker_connections"
       WHERE "auto_sync" AND "status" <> 'disabled'`,
    );
    return rows.map((row) => row.user_id);
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MailConnection } from './entities/mail-connection.entity';
import { MailBackfillStatus, MailSender } from './entities/mail-sender.entity';
import {
  GmailApi,
  GmailClientService,
  isNotFound,
} from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { MailIngestionService } from './mail-ingestion.service';
import { MailSendersService } from './mail-senders.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Cuándo se leen los correos:
//  - NUEVOS: por el historial de Gmail, desde el último historyId procesado.
//    Lo dispara el push de Pub/Sub al instante y el job horario de respaldo.
//  - ANTIGUOS: con una búsqueda por remitente, a petición del usuario o al
//    crear el remitente con backfillFrom.
@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);
  // Cerrojos en proceso. Dos pushes seguidos del mismo buzón no deben leer el
  // historial a la vez; los datos ya son idempotentes, esto ahorra llamadas.
  private readonly syncing = new Set<string>();
  private readonly backfilling = new Set<string>();

  constructor(
    private readonly connectionsService: MailConnectionsService,
    private readonly sendersService: MailSendersService,
    private readonly ingestionService: MailIngestionService,
    private readonly gmailClient: GmailClientService,
  ) {}

  async syncAll(): Promise<void> {
    for (const connection of await this.connectionsService.findActive()) {
      await this.syncHistory(connection);
    }
  }

  // Nunca lanza: lo llaman el webhook y el cron, y un fallo de un buzón no
  // debe tumbar a los demás. El error queda en last_error.
  async syncHistory(connection: MailConnection): Promise<void> {
    if (this.syncing.has(connection.id)) {
      return;
    }
    this.syncing.add(connection.id);
    try {
      const api = this.connectionsService.gmailFor(connection);
      if (!connection.historyId) {
        await this.connectionsService.markSynced(
          connection.id,
          await this.gmailClient.currentHistoryId(api),
        );
        return;
      }

      const senders = await this.sendersService.activeByAddress(connection.id);
      let added: { messageIds: string[]; historyId: string };
      try {
        added = await this.gmailClient.messagesAddedSince(
          api,
          connection.historyId,
        );
      } catch (error) {
        // Gmail guarda el historial ~1 semana: si el servidor estuvo caído
        // más tiempo, se recupera con una búsqueda por fecha
        if (!isNotFound(error)) {
          throw error;
        }
        await this.recoverExpiredHistory(connection, api, senders);
        return;
      }

      await this.ingestAll(connection, api, added.messageIds, senders);
      await this.connectionsService.markSynced(connection.id, added.historyId);
    } catch (error) {
      this.logger.warn(
        `Fallo sincronizando el correo ${connection.id}: ${(error as Error).message}`,
      );
      await this.connectionsService.recordFailure(connection, error);
    } finally {
      this.syncing.delete(connection.id);
    }
  }

  // Arranca la lectura de correos antiguos de un remitente y vuelve sin
  // esperar: con años de facturas puede tardar minutos. El progreso se ve en
  // backfillStatus y en la bitácora de correos.
  async startBackfill(
    userId: string,
    senderId: string,
    since?: string,
  ): Promise<MailSender> {
    const sender = await this.sendersService.findOne(senderId, userId);
    if (since && !DATE.test(since)) {
      throw new BadRequestException('since debe ser YYYY-MM-DD');
    }
    // "running" en la base pero no en este proceso = quedó colgado por un
    // reinicio; se permite relanzarlo
    if (this.backfilling.has(sender.id)) {
      throw new ConflictException(
        'Ya se están leyendo los correos antiguos de este remitente',
      );
    }
    const from = since ?? sender.backfillFrom;
    await this.sendersService.setBackfill(
      sender.id,
      MailBackfillStatus.RUNNING,
      null,
      from,
    );
    void this.runBackfill(sender, from);
    return this.sendersService.findOne(senderId, userId);
  }

  // Renueva las suscripciones push que caducan en menos de 2 días.
  async renewWatches(): Promise<void> {
    if (!this.gmailClient.pushConfigured) {
      return;
    }
    const expiring = await this.connectionsService.findWatchesExpiringBefore(
      new Date(Date.now() + 2 * DAY_MS),
    );
    for (const connection of expiring) {
      try {
        await this.connectionsService.renewWatch(connection);
      } catch (error) {
        this.logger.warn(
          `No se pudo renovar el push de ${connection.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async runBackfill(
    sender: MailSender,
    from: string | null,
  ): Promise<void> {
    this.backfilling.add(sender.id);
    try {
      const connection = await this.connectionsService.findOne(
        sender.connectionId,
        sender.userId,
      );
      const api = this.connectionsService.gmailFor(connection);
      const query =
        `from:${sender.emailAddress} has:attachment` +
        (from ? ` after:${from.replace(/-/g, '/')}` : '');
      const ids = await this.gmailClient.searchMessages(api, query);
      const failed = await this.ingestAll(
        connection,
        api,
        ids,
        new Map([[sender.emailAddress, sender]]),
        false,
      );
      await this.sendersService.setBackfill(
        sender.id,
        MailBackfillStatus.DONE,
        failed > 0 ? `${failed} correo(s) no se pudieron leer` : null,
      );
    } catch (error) {
      this.logger.warn(
        `Fallo leyendo correos antiguos de ${sender.emailAddress}: ${(error as Error).message}`,
      );
      await this.sendersService.setBackfill(
        sender.id,
        MailBackfillStatus.FAILED,
        (error as Error).message,
      );
    } finally {
      this.backfilling.delete(sender.id);
    }
  }

  private async recoverExpiredHistory(
    connection: MailConnection,
    api: GmailApi,
    senders: Map<string, MailSender>,
  ): Promise<void> {
    const historyId = await this.gmailClient.currentHistoryId(api);
    if (senders.size > 0) {
      // un día de solape: los correos ya procesados se saltan solos
      const since = new Date(
        (connection.lastSyncedAt?.getTime() ?? Date.now() - 7 * DAY_MS) -
          DAY_MS,
      );
      const query =
        `from:(${[...senders.keys()].join(' OR ')}) has:attachment ` +
        `after:${Math.floor(since.getTime() / 1000)}`;
      const ids = await this.gmailClient.searchMessages(api, query);
      await this.ingestAll(connection, api, ids, senders);
    }
    await this.connectionsService.markSynced(connection.id, historyId);
  }

  // Procesa los correos uno a uno. Con `strict`, un fallo al LEER un correo
  // (no al registrarlo: eso queda en la bitácora) aborta después del lote,
  // para no avanzar el historyId y reintentarlo en la siguiente pasada.
  // Devuelve cuántos correos no se pudieron leer.
  private async ingestAll(
    connection: MailConnection,
    api: GmailApi,
    messageIds: string[],
    senders: Map<string, MailSender>,
    strict = true,
  ): Promise<number> {
    if (senders.size === 0) {
      return 0;
    }
    let failed = 0;
    let lastError: unknown = null;
    for (const messageId of messageIds) {
      try {
        await this.ingestionService.ingest(connection, api, messageId, senders);
      } catch (error) {
        failed += 1;
        lastError = error;
        this.logger.warn(
          `No se pudo leer el correo ${messageId}: ${(error as Error).message}`,
        );
      }
    }
    if (strict && lastError) {
      throw lastError;
    }
    return failed;
  }
}

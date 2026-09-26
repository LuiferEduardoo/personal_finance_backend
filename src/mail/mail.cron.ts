import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MailSyncService } from './mail-sync.service';

const SYNC_LOCK = 'mail_sync';
const WATCH_LOCK = 'mail_watch_renewal';

// El push de Gmail es la vía principal; esto es la red de seguridad. Pub/Sub
// puede perder notificaciones o el servidor puede estar caído cuando llegan,
// y la suscripción push caduca a los 7 días si nadie la renueva.
@Injectable()
export class MailCron {
  private readonly logger = new Logger(MailCron.name);
  private syncRunning = false;

  constructor(
    private readonly syncService: MailSyncService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async syncAll(): Promise<void> {
    if (this.syncRunning) {
      return;
    }
    this.syncRunning = true;
    try {
      await this.withLock(SYNC_LOCK, () => this.syncService.syncAll());
    } catch (error) {
      // se traga y registra: una excepción aquí mataría el scheduler
      this.logger.error(
        `Fallo en la sincronización del correo: ${(error as Error).message}`,
      );
    } finally {
      this.syncRunning = false;
    }
  }

  // 04:00, después del resto de jobs nocturnos
  @Cron('0 4 * * *')
  async renewWatches(): Promise<void> {
    try {
      await this.withLock(WATCH_LOCK, () => this.syncService.renewWatches());
    } catch (error) {
      this.logger.error(
        `Fallo renovando las suscripciones push: ${(error as Error).message}`,
      );
    }
  }

  private async withLock(
    name: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [name],
    );
    if (!row?.locked) {
      this.logger.warn(`Otra instancia tiene el cerrojo ${name}; se omite`);
      return;
    }
    try {
      await work();
    } finally {
      // el finally es obligatorio: un cerrojo consultivo que no se suelta
      // bloquea el job para siempre
      await this.dataSource.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
        name,
      ]);
    }
  }
}

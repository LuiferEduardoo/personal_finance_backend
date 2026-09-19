import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvestmentSyncService } from './investment-sync.service';

const SYNC_LOCK = 'investment_broker_sync';

// 01:30, antes del refresco de precios de las 02:00: así las posiciones nuevas
// que traiga la sincronización ya entran en el refresco de esa misma noche.
@Injectable()
export class InvestmentsSyncCron {
  private readonly logger = new Logger(InvestmentsSyncCron.name);
  private running = false;

  constructor(
    private readonly syncService: InvestmentSyncService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron('30 1 * * *')
  async syncAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('La sincronización anterior sigue en marcha');
      return;
    }
    this.running = true;
    try {
      const [row] = await this.dataSource.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [SYNC_LOCK],
      );
      if (!row?.locked) {
        this.logger.warn('Otra instancia está sincronizando; se omite');
        return;
      }
      try {
        const users = await this.syncService.usersWithAutoSync();
        let inserted = 0;
        let errors = 0;
        for (const userId of users) {
          // solo las marcadas con auto_sync; una conexión que falla no aborta
          // las de los demás usuarios
          const reports = await this.syncService.syncAll(userId, true);
          for (const report of reports) {
            inserted += report.inserted;
            errors += report.errors.length;
          }
        }
        this.logger.log(
          `Sincronización de brókers: ${users.length} usuario(s), ` +
            `${inserted} operación(es) nueva(s), ${errors} error(es)`,
        );
      } finally {
        await this.dataSource.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
          SYNC_LOCK,
        ]);
      }
    } catch (error) {
      // se traga y registra: una excepción aquí mataría el scheduler
      this.logger.error(
        `Fallo en la sincronización de brókers: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}

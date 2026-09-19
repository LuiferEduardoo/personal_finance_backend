import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnapshotsService } from './snapshots.service';

const SNAPSHOTS_LOCK = 'investment_snapshots';

// 02:30, media hora después del refresco de precios, para que la valoración
// diaria use los cierres de hoy y no los de ayer.
//
// Mismas protecciones que market-data.cron.ts: try/catch para que un fallo no
// tumbe el scheduler, bandera en proceso y cerrojo consultivo de Postgres para
// que dos instancias no se solapen.
@Injectable()
export class SnapshotsCron {
  private readonly logger = new Logger(SnapshotsCron.name);
  private running = false;

  constructor(
    private readonly snapshotsService: SnapshotsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron('30 2 * * *')
  async buildDaily(): Promise<void> {
    if (this.running) {
      this.logger.warn('La construcción de snapshots anterior sigue en marcha');
      return;
    }
    this.running = true;
    try {
      const [row] = await this.dataSource.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [SNAPSHOTS_LOCK],
      );
      if (!row?.locked) {
        this.logger.warn(
          'Otra instancia está construyendo snapshots; se omite',
        );
        return;
      }
      try {
        // las tasas primero: valorar sin ellas marca todos los días como
        // estimados
        for (const userId of await this.snapshotsService.usersWithActivity()) {
          await this.snapshotsService.ensureFxRates(userId);
        }
        const report = await this.snapshotsService.buildSnapshots();
        this.logger.log(
          `Snapshots: ${report.days} días de ${report.users} usuario(s), ` +
            `${report.estimatedDays} estimados`,
        );
      } finally {
        await this.dataSource.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
          SNAPSHOTS_LOCK,
        ]);
      }
    } catch (error) {
      this.logger.error(
        `Fallo construyendo snapshots: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CorporateActionsService } from './corporate-actions.service';
import { InstrumentsService } from './instruments.service';
import { PricesService } from './prices.service';

// Cerrojo de Postgres: dos instancias del backend no pueden solaparse en el
// mismo job, y un job que se alarga tampoco se pisa a sí mismo.
const PRICES_LOCK = 'market_data_prices';
const ACTIONS_LOCK = 'market_data_corporate_actions';

// Solo precios y tasas. Los snapshots van en investments/snapshots.cron.ts,
// porque la dependencia entre módulos va investments -> market-data y nunca al
// revés.
//
// A diferencia de recurring-expenses.cron.ts, que no tiene NINGUNA protección,
// aquí hay try/catch, bandera en proceso y cerrojo de base de datos. Un fallo
// del proveedor no puede tumbar el scheduler.
@Injectable()
export class MarketDataCron {
  private readonly logger = new Logger(MarketDataCron.name);
  private pricesRunning = false;
  private actionsRunning = false;

  constructor(
    private readonly pricesService: PricesService,
    private readonly instrumentsService: InstrumentsService,
    private readonly corporateActionsService: CorporateActionsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // 02:00: precios y tasas. Antes del job de gastos recurrentes de las 03:00.
  @Cron('0 2 * * *')
  async refreshPrices(): Promise<void> {
    if (this.pricesRunning) {
      this.logger.warn('El refresco de precios anterior sigue en marcha');
      return;
    }
    this.pricesRunning = true;
    try {
      await this.withLock(PRICES_LOCK, async () => {
        // primero se recalcula QUÉ hay que refrescar: solo lo que alguien
        // tiene en cartera hoy más los benchmarks
        await this.instrumentsService.refreshNeedsDailyPrice();
        const report = await this.pricesService.refreshPrices();
        this.logger.log(
          `Precios: ${report.refreshed} barras, ${report.backfilled} backfills, ` +
            `${report.creditsUsed} créditos` +
            (report.budgetExhausted ? ' (presupuesto agotado)' : ''),
        );
      });
    } catch (error) {
      // se traga y registra: una excepción aquí mataría el scheduler
      this.logger.error(
        `Fallo en el refresco de precios: ${(error as Error).message}`,
      );
    } finally {
      this.pricesRunning = false;
    }
  }

  // Mensual, el día 1 a las 03:30: dividendos y splits cambian poco y cuestan
  // 2 créditos por instrumento. Consultarlos a diario sería tirar presupuesto.
  @Cron('30 3 1 * *')
  async refreshCorporateActions(): Promise<void> {
    if (this.actionsRunning) {
      return;
    }
    this.actionsRunning = true;
    try {
      await this.withLock(ACTIONS_LOCK, async () => {
        const report = await this.corporateActionsService.refresh();
        this.logger.log(
          `Acciones corporativas: ${report.instruments} instrumento(s), ` +
            `${report.dividends} dividendo(s), ${report.splits} split(s)` +
            (report.budgetExhausted ? ' (presupuesto agotado)' : ''),
        );
      });
    } catch (error) {
      this.logger.error(
        `Fallo trayendo acciones corporativas: ${(error as Error).message}`,
      );
    } finally {
      this.actionsRunning = false;
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

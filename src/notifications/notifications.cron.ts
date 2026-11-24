import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

// limpieza diaria: las notificaciones leídas viejas ya no aportan
@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(private readonly notifications: NotificationsService) {}

  @Cron('0 4 * * *', { timeZone: 'America/Bogota' })
  async purgeRead(): Promise<void> {
    try {
      const removed = await this.notifications.purgeRead();
      if (removed > 0) {
        this.logger.log(`Notificaciones leídas borradas: ${removed}`);
      }
    } catch (error) {
      this.logger.error('No se pudieron borrar las notificaciones', error);
    }
  }
}

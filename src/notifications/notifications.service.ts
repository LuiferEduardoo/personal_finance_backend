import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { NotificationsFilterInput } from './dto/notifications-filter.input';
import { Notification, NotificationType } from './entities/notification.entity';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  // identifica el evento: la misma clave no se notifica dos veces al usuario
  dedupeKey: string;
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;
// las leídas se conservan este tiempo y luego las borra el cron
export const READ_RETENTION_DAYS = 90;

/**
 * Notificaciones dentro de la app. Los productores (presupuestos, créditos,
 * correo, recurrentes) llaman a `notify`/`notifyMany`, que nunca lanzan: una
 * notificación perdida no debe romper el flujo que la origina.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
  ) {}

  // INSERT ... ON CONFLICT DO NOTHING; devuelve si la insertó
  async notify(userId: string, input: NotifyInput): Promise<boolean> {
    return (await this.notifyMany([{ userId, ...input }])) > 0;
  }

  // varias en un solo INSERT; devuelve cuántas se insertaron
  async notifyMany(
    inputs: (NotifyInput & { userId: string })[],
  ): Promise<number> {
    if (!inputs.length) {
      return 0;
    }
    try {
      const result = await this.notificationsRepository
        .createQueryBuilder()
        .insert()
        .into(Notification)
        .values(
          inputs.map((input) => ({
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey,
          })),
        )
        .orIgnore()
        .returning(['id'])
        .execute();
      return (result.raw as { id: string }[] | undefined)?.length ?? 0;
    } catch (error) {
      this.logger.error(
        `No se pudieron guardar ${inputs.length} notificaciones (${inputs[0].dedupeKey}...)`,
        error,
      );
      return 0;
    }
  }

  // borra las notificaciones de esas claves (p. ej. para poder volver a
  // avisar). Tampoco lanza.
  async removeByDedupeKeys(dedupeKeys: string[]): Promise<void> {
    if (!dedupeKeys.length) {
      return;
    }
    try {
      await this.notificationsRepository.delete({ dedupeKey: In(dedupeKeys) });
    } catch (error) {
      this.logger.error(
        `No se pudieron borrar las notificaciones ${dedupeKeys.join(', ')}`,
        error,
      );
    }
  }

  // las más recientes primero
  findAll(
    userId: string,
    filter?: NotificationsFilterInput,
  ): Promise<Notification[]> {
    const limit = Math.min(
      Math.max(filter?.limit ?? DEFAULT_PAGE, 1),
      MAX_PAGE,
    );
    const offset = Math.max(filter?.offset ?? 0, 0);
    return this.notificationsRepository.find({
      where: { userId, ...(filter?.unreadOnly ? { readAt: IsNull() } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  unreadCount(userId: string): Promise<number> {
    return this.notificationsRepository.count({
      where: { userId, readAt: IsNull() },
    });
  }

  // idempotente: si ya estaba leída conserva la fecha original
  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.findOwned(userId, id);
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepository.update(
        { id, userId, readAt: IsNull() },
        { readAt: notification.readAt },
      );
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.notificationsRepository.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return result.affected ?? 0;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.notificationsRepository.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Notificación ${id} no encontrada`);
    }
    return true;
  }

  // borra las leídas con más de READ_RETENTION_DAYS días
  async purgeRead(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - READ_RETENTION_DAYS * 86_400_000);
    const result = await this.notificationsRepository.delete({
      readAt: Not(IsNull()),
      createdAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }

  // las de otro usuario no se encuentran
  private async findOwned(userId: string, id: string): Promise<Notification> {
    const notification = await this.notificationsRepository.findOne({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException(`Notificación ${id} no encontrada`);
    }
    return notification;
  }
}

import { NotFoundException } from '@nestjs/common';
import { FindOperator, Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const input = {
    type: NotificationType.BUDGET_EXCEEDED,
    title: 'Superaste tu presupuesto de Mercado',
    body: 'Llevas $ 400.000',
    link: '/presupuestos',
    dedupeKey: 'budget-exceeded:budget-1:2026-11',
  };

  function setup({
    inserted = true,
    executeError,
    found = null as Partial<Notification> | null,
  }: {
    inserted?: boolean;
    executeError?: Error;
    found?: Partial<Notification> | null;
  } = {}) {
    const builder = {
      insert: jest.fn(() => builder),
      into: jest.fn(() => builder),
      values: jest.fn(() => builder),
      orIgnore: jest.fn(() => builder),
      returning: jest.fn(() => builder),
      execute: executeError
        ? jest.fn().mockRejectedValue(executeError)
        : jest.fn().mockResolvedValue({ raw: inserted ? [{ id: 'n-1' }] : [] }),
    };
    const repository = {
      createQueryBuilder: () => builder,
      findOne: jest.fn().mockResolvedValue(found),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue({ affected: 2 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new NotificationsService(
      repository as unknown as Repository<Notification>,
    );
    return { service, builder, repository };
  }

  describe('notify', () => {
    it('inserta con ON CONFLICT DO NOTHING y devuelve true', async () => {
      const ctx = setup();
      await expect(ctx.service.notify('user-1', input)).resolves.toBe(true);
      expect(ctx.builder.values).toHaveBeenCalledWith([
        { userId: 'user-1', ...input },
      ]);
      expect(ctx.builder.orIgnore).toHaveBeenCalled();
    });

    it('con la misma dedupeKey el insert se ignora y devuelve false', async () => {
      const ctx = setup({ inserted: false });
      await expect(ctx.service.notify('user-1', input)).resolves.toBe(false);
    });

    it('nunca lanza: si la base falla registra y devuelve false', async () => {
      const ctx = setup({ executeError: new Error('BD caída') });
      await expect(ctx.service.notify('user-1', input)).resolves.toBe(false);
    });

    it('sin link guarda null', async () => {
      const ctx = setup();
      await ctx.service.notify('user-1', { ...input, link: undefined });
      expect(ctx.builder.values).toHaveBeenCalledWith([
        expect.objectContaining({ link: null }),
      ]);
    });
  });

  it('notifyMany inserta todas en un solo INSERT y cuenta las nuevas', async () => {
    const ctx = setup();
    ctx.builder.execute.mockResolvedValue({ raw: [{ id: 'a' }, { id: 'b' }] });
    const count = await ctx.service.notifyMany([
      { userId: 'user-1', ...input },
      { userId: 'user-2', ...input },
      { userId: 'user-3', ...input },
    ]);
    expect(count).toBe(2);
    expect(ctx.builder.execute).toHaveBeenCalledTimes(1);
  });

  it('notifyMany sin entradas no consulta la base', async () => {
    const ctx = setup();
    await expect(ctx.service.notifyMany([])).resolves.toBe(0);
    expect(ctx.builder.insert).not.toHaveBeenCalled();
  });

  describe('markRead', () => {
    it('no encuentra la notificación de otro usuario', async () => {
      const ctx = setup({ found: null });
      await expect(
        ctx.service.markRead('user-2', 'n-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ctx.repository.findOne).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: 'user-2' },
      });
      expect(ctx.repository.update).not.toHaveBeenCalled();
    });

    it('marca la no leída', async () => {
      const ctx = setup({
        found: { id: 'n-1', userId: 'user-1', readAt: null },
      });
      const result = await ctx.service.markRead('user-1', 'n-1');
      expect(result.readAt).toBeInstanceOf(Date);
      expect(ctx.repository.update).toHaveBeenCalledTimes(1);
    });

    it('es idempotente: una ya leída conserva su fecha', async () => {
      const readAt = new Date('2026-11-01T10:00:00Z');
      const ctx = setup({ found: { id: 'n-1', userId: 'user-1', readAt } });
      const result = await ctx.service.markRead('user-1', 'n-1');
      expect(result.readAt).toBe(readAt);
      expect(ctx.repository.update).not.toHaveBeenCalled();
    });
  });

  it('markAllRead marca solo las no leídas del usuario y devuelve cuántas', async () => {
    const ctx = setup();
    await expect(ctx.service.markAllRead('user-1')).resolves.toBe(2);
    const [where] = ctx.repository.update.mock.calls[0] as [
      { userId: string; readAt: FindOperator<unknown> },
    ];
    expect(where.userId).toBe('user-1');
    expect(where.readAt.type).toBe('isNull');
  });

  it('remove de una ajena lanza NotFound', async () => {
    const ctx = setup();
    ctx.repository.delete.mockResolvedValue({ affected: 0 });
    await expect(ctx.service.remove('user-2', 'n-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.repository.delete).toHaveBeenCalledWith({
      id: 'n-1',
      userId: 'user-2',
    });
  });

  it('findAll acota el límite a 100 y filtra las no leídas', async () => {
    const ctx = setup();
    await ctx.service.findAll('user-1', {
      unreadOnly: true,
      limit: 500,
      offset: 40,
    });
    const [options] = ctx.repository.find.mock.calls[0] as [
      { where: { readAt: FindOperator<unknown> }; take: number; skip: number },
    ];
    expect(options.take).toBe(100);
    expect(options.skip).toBe(40);
    expect(options.where.readAt.type).toBe('isNull');
  });

  it('purgeRead borra las leídas de hace más de 90 días', async () => {
    const ctx = setup();
    await ctx.service.purgeRead(new Date('2026-11-24T00:00:00Z'));
    const [where] = ctx.repository.delete.mock.calls[0] as [
      { readAt: FindOperator<unknown>; createdAt: FindOperator<Date> },
    ];
    expect(where.readAt.type).toBe('not');
    expect(where.createdAt.type).toBe('lessThan');
    expect(where.createdAt.value).toEqual(new Date('2026-08-26T00:00:00Z'));
  });
});

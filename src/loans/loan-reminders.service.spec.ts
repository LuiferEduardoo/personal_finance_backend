import { Repository } from 'typeorm';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { LoanInstallment } from './entities/loan-installment.entity';
import {
  LoanReminderRow,
  LoanRemindersService,
  todayIn,
} from './loan-reminders.service';

describe('LoanRemindersService', () => {
  const row = (partial: Partial<LoanReminderRow>): LoanReminderRow => ({
    installmentId: 'inst-1',
    loanId: 'loan-1',
    userId: 'user-1',
    loanName: 'Crédito carro',
    currency: 'COP',
    sequenceNumber: 3,
    installmentCount: 36,
    amount: '1250000.00',
    dueDate: '2026-11-26',
    ...partial,
  });

  function setup(rows: LoanReminderRow[]) {
    const installmentsRepository = {
      query: jest.fn().mockResolvedValue(rows),
    };
    const notifications = {
      notifyMany: jest.fn((inputs: unknown[]) =>
        Promise.resolve(inputs.length),
      ),
    };
    const service = new LoanRemindersService(
      installmentsRepository as unknown as Repository<LoanInstallment>,
      notifications as unknown as NotificationsService,
    );
    return { service, installmentsRepository, notifications };
  }

  it('selecciona en una sola consulta las pendientes de créditos activos hasta hoy + 3 días', async () => {
    const ctx = setup([]);
    await ctx.service.run('2026-11-24');
    expect(ctx.installmentsRepository.query).toHaveBeenCalledTimes(1);
    const [sql, params] = ctx.installmentsRepository.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sql).toContain(`i."status" = 'pending'`);
    expect(sql).toContain(`l."status" = 'active'`);
    expect(sql).toContain(`i."due_date" <= $1::date + $2::int`);
    expect(params).toEqual(['2026-11-24', 3]);
  });

  it('separa por vencer y vencidas y las inserta todas juntas', async () => {
    const ctx = setup([
      row({ installmentId: 'due', dueDate: '2026-11-26' }),
      row({ installmentId: 'today', dueDate: '2026-11-24' }),
      row({ installmentId: 'late', dueDate: '2026-11-20', userId: 'user-2' }),
    ]);
    await expect(ctx.service.run('2026-11-24')).resolves.toBe(3);
    expect(ctx.notifications.notifyMany).toHaveBeenCalledTimes(1);
    const [inputs] = ctx.notifications.notifyMany.mock.calls[0] as [
      {
        userId: string;
        type: NotificationType;
        body: string;
        link: string;
        dedupeKey: string;
      }[],
    ];
    expect(inputs.map((input) => [input.type, input.dedupeKey])).toEqual([
      [NotificationType.LOAN_INSTALLMENT_DUE, 'loan-due:due'],
      [NotificationType.LOAN_INSTALLMENT_DUE, 'loan-due:today'],
      [NotificationType.LOAN_INSTALLMENT_OVERDUE, 'loan-overdue:late'],
    ]);
    expect(inputs[2].userId).toBe('user-2');
    expect(inputs[0].link).toBe('/creditos/loan-1');
    const money = (1250000).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    expect(inputs[0].body).toContain('Crédito carro');
    expect(inputs[0].body).toContain('3/36');
    expect(inputs[0].body).toContain(money);
    expect(inputs[0].body).toContain('26 de noviembre de 2026');
  });

  it('todayIn usa la fecha de Bogotá', () => {
    // 03:00 UTC del 25 = 22:00 del 24 en Bogotá
    expect(todayIn('America/Bogota', new Date('2026-11-25T03:00:00Z'))).toBe(
      '2026-11-24',
    );
  });
});

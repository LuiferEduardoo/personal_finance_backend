import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationType } from '../notifications/entities/notification.entity';
import {
  NotificationsService,
  NotifyInput,
} from '../notifications/notifications.service';
import { LoanInstallment } from './entities/loan-installment.entity';

export const LOAN_REMINDERS_TIME_ZONE = 'America/Bogota';
// se avisa de las cuotas que vencen de hoy a esta cantidad de días
export const LOAN_DUE_SOON_DAYS = 3;

export interface LoanReminderRow {
  installmentId: string;
  loanId: string;
  userId: string;
  loanName: string;
  currency: string;
  sequenceNumber: number;
  installmentCount: number;
  amount: string;
  dueDate: string;
}

/**
 * Recordatorios de cuotas de créditos: las PENDIENTES de créditos ACTIVOS
 * que vencen en los próximos días (LOAN_INSTALLMENT_DUE) o que ya vencieron
 * (LOAN_INSTALLMENT_OVERDUE). Una sola consulta para todos los usuarios y un
 * solo INSERT; la dedupeKey por cuota hace que cada aviso salga una vez.
 */
@Injectable()
export class LoanRemindersService {
  private readonly logger = new Logger(LoanRemindersService.name);

  constructor(
    @InjectRepository(LoanInstallment)
    private readonly installmentsRepository: Repository<LoanInstallment>,
    private readonly notifications: NotificationsService,
  ) {}

  // devuelve cuántas notificaciones nuevas se crearon
  async run(
    today: string = todayIn(LOAN_REMINDERS_TIME_ZONE),
  ): Promise<number> {
    const rows = await this.findCandidates(today);
    const inserted = await this.notifications.notifyMany(
      rows.map((row) => ({
        userId: row.userId,
        ...toNotification(row, today),
      })),
    );
    if (inserted > 0) {
      this.logger.log(`Recordatorios de cuotas creados: ${inserted}`);
    }
    return inserted;
  }

  // cuotas pendientes de créditos activos con vencimiento <= hoy + N días
  findCandidates(today: string): Promise<LoanReminderRow[]> {
    return this.installmentsRepository.query(
      `
        SELECT i."id" AS "installmentId",
               i."loan_id" AS "loanId",
               l."user_id" AS "userId",
               l."name" AS "loanName",
               l."currency",
               i."sequence_number" AS "sequenceNumber",
               (SELECT COUNT(*)::int FROM "loan_installments" t
                 WHERE t."loan_id" = i."loan_id") AS "installmentCount",
               i."amount",
               to_char(i."due_date", 'YYYY-MM-DD') AS "dueDate"
        FROM "loan_installments" i
        JOIN "loans" l ON l."id" = i."loan_id"
        JOIN "users" u ON u."id" = l."user_id"
        WHERE i."status" = 'pending'
          AND l."status" = 'active'
          AND u."is_active"
          AND i."due_date" <= $1::date + $2::int
      `,
      [today, LOAN_DUE_SOON_DAYS],
    );
  }
}

export function toNotification(
  row: LoanReminderRow,
  today: string,
): NotifyInput {
  const overdue = row.dueDate < today;
  const amount = Number(row.amount).toLocaleString('es-CO', {
    style: 'currency',
    currency: row.currency,
  });
  const installment = `cuota ${row.sequenceNumber}/${row.installmentCount}`;
  const dueOn = formatDate(row.dueDate);
  return overdue
    ? {
        type: NotificationType.LOAN_INSTALLMENT_OVERDUE,
        title: `Cuota vencida de ${row.loanName}`,
        body: `La ${installment} de ${row.loanName} por ${amount} venció el ${dueOn} y sigue pendiente.`,
        link: `/creditos/${row.loanId}`,
        dedupeKey: `loan-overdue:${row.installmentId}`,
      }
    : {
        type: NotificationType.LOAN_INSTALLMENT_DUE,
        title: `Se acerca una cuota de ${row.loanName}`,
        body: `La ${installment} de ${row.loanName} por ${amount} vence el ${dueOn}.`,
        link: `/creditos/${row.loanId}`,
        dedupeKey: `loan-due:${row.installmentId}`,
      };
}

// fecha de hoy (YYYY-MM-DD) en la zona horaria dada
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// "2026-11-27" -> "27 de noviembre de 2026"
function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmailService } from '../notifications/email.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { currentPeriod, formatPeriod, periodOf } from './budget-period';
import { CategoryBudgetAlert } from './entities/category-budget-alert.entity';
import { CategoryBudget } from './entities/category-budget.entity';

interface SpentRow {
  budgetId: string;
  spent: string;
}

// a partir de este porcentaje del tope se avisa (solo en la app) que se acerca
export const BUDGET_NEAR_RATIO = 0.8;

/**
 * Avisa por correo cuando el gasto del mes de una categoría (con sus
 * subcategorías) supera su presupuesto. Un aviso por presupuesto y mes:
 * `category_budget_alerts` con índice único hace de cerrojo, así que volver a
 * evaluar es idempotente (lo hace cada gasto y, de respaldo, el cron diario).
 * Nunca lanza hacia quien registra el gasto. Además deja una notificación en
 * la app al superarlo (BUDGET_EXCEEDED) y al llegar al 80 % (BUDGET_NEAR, sin
 * correo), deduplicadas por presupuesto y mes con su `dedupeKey`.
 */
@Injectable()
export class BudgetAlertsService {
  private readonly logger = new Logger(BudgetAlertsService.name);

  constructor(
    @InjectRepository(CategoryBudget)
    private readonly budgetsRepository: Repository<CategoryBudget>,
    @InjectRepository(CategoryBudgetAlert)
    private readonly alertsRepository: Repository<CategoryBudgetAlert>,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Dispara la revisión sin esperarla: el registro del gasto no se bloquea
   * ni falla por los presupuestos.
   */
  scheduleExpenseCheck(
    userId: string,
    categoryId: string | null,
    occurredOn: string,
  ): void {
    if (!categoryId) {
      return;
    }
    void this.checkExpense(userId, categoryId, occurredOn);
  }

  /**
   * Revisa los presupuestos afectados por un gasto: los de su categoría y los
   * de cualquier ancestro, en el mes del gasto.
   */
  async checkExpense(
    userId: string,
    categoryId: string,
    occurredOn: string,
  ): Promise<void> {
    try {
      const rows: { id: string }[] = await this.budgetsRepository.query(
        `
          WITH RECURSIVE ancestors AS (
            SELECT c."id", c."parent_id" FROM "categories" c WHERE c."id" = $1
            UNION
            SELECT p."id", p."parent_id"
            FROM "categories" p
            JOIN ancestors a ON p."id" = a."parent_id"
          )
          SELECT b."id"
          FROM "category_budgets" b
          WHERE b."user_id" = $2
            AND b."category_id" IN (SELECT "id" FROM ancestors)
        `,
        [categoryId, userId],
      );
      if (!rows.length) {
        return;
      }
      const budgets = await this.budgetsRepository.find({
        where: { id: In(rows.map((row) => row.id)) },
        relations: { user: true, category: true },
      });
      await this.evaluate(budgets, periodOf(occurredOn));
    } catch (error) {
      this.logger.error(
        `No se pudieron revisar los presupuestos del usuario ${userId}`,
        error,
      );
    }
  }

  // revisa un presupuesto en el mes en curso (tras crearlo o cambiar su monto)
  async checkBudget(budgetId: string): Promise<void> {
    try {
      const budgets = await this.budgetsRepository.find({
        where: { id: budgetId },
        relations: { user: true, category: true },
      });
      await this.evaluate(budgets, currentPeriod());
    } catch (error) {
      this.logger.error(`No se pudo revisar el presupuesto ${budgetId}`, error);
    }
  }

  // red de seguridad del cron: todos los presupuestos en el mes en curso
  async checkAll(period: string = currentPeriod()): Promise<void> {
    const budgets = await this.budgetsRepository.find({
      relations: { user: true, category: true },
    });
    await this.evaluate(budgets, period);
  }

  /**
   * Gasto del mes por presupuesto, en moneda base (amount * exchange_rate,
   * igual que la inflación de gasto), sumando la categoría y todas sus
   * subcategorías (recursivo). Solo cuenta los gastos del dueño del
   * presupuesto.
   */
  async spentByBudget(
    budgetIds: string[],
    period: string,
  ): Promise<Map<string, number>> {
    if (!budgetIds.length) {
      return new Map();
    }
    const rows: SpentRow[] = await this.budgetsRepository.query(
      `
        WITH RECURSIVE tree AS (
          SELECT b."id" AS budget_id, b."user_id", b."category_id"
          FROM "category_budgets" b
          WHERE b."id" = ANY($1::uuid[])
          UNION
          SELECT t.budget_id, t."user_id", c."id"
          FROM tree t
          JOIN "categories" c ON c."parent_id" = t."category_id"
        )
        SELECT t.budget_id AS "budgetId",
               COALESCE(SUM(e."amount" * e."exchange_rate"), 0) AS spent
        FROM tree t
        LEFT JOIN "expenses" e
          ON e."category_id" = t."category_id"
         AND e."user_id" = t."user_id"
         AND e."occurred_on" >= to_date($2, 'YYYY-MM')
         AND e."occurred_on" < to_date($2, 'YYYY-MM') + INTERVAL '1 month'
        GROUP BY t.budget_id
      `,
      [budgetIds, period],
    );
    return new Map(rows.map((row) => [row.budgetId, Number(row.spent)]));
  }

  // borra el aviso del mes para que se pueda volver a avisar (p. ej. al subir
  // el monto del presupuesto). También borra sus notificaciones del mes, leídas
  // o no: hablan de un tope que ya no aplica y su dedupeKey impediría volver a
  // notificar.
  async resetAlert(budgetId: string, period: string): Promise<void> {
    await this.alertsRepository.delete({ budgetId, period });
    await this.notifications.removeByDedupeKeys([
      exceededKey(budgetId, period),
      nearKey(budgetId, period),
    ]);
  }

  private async evaluate(
    budgets: CategoryBudget[],
    period: string,
  ): Promise<void> {
    const candidates = budgets.filter((budget) => budget.user?.isActive);
    const spentByBudget = await this.spentByBudget(
      candidates.map((budget) => budget.id),
      period,
    );
    for (const budget of candidates) {
      const spent = spentByBudget.get(budget.id) ?? 0;
      if (spent <= budget.amount) {
        if (spent >= budget.amount * BUDGET_NEAR_RATIO) {
          await this.notifyNear(budget, period, spent);
        }
        continue;
      }
      // independiente del correo: si Brevo falla, la app igual avisa
      await this.notifyExceeded(budget, period, spent);
      try {
        await this.alert(budget, period, spent);
      } catch (error) {
        this.logger.error(
          `No se pudo avisar sobre el presupuesto ${budget.id}`,
          error,
        );
      }
    }
  }

  private async alert(
    budget: CategoryBudget,
    period: string,
    spent: number,
  ): Promise<void> {
    // solo envía quien logra insertar el aviso del mes
    const inserted = await this.alertsRepository
      .createQueryBuilder()
      .insert()
      .into(CategoryBudgetAlert)
      .values({ budgetId: budget.id, period, spent })
      .orIgnore()
      .returning(['id'])
      .execute();
    const alertId = (inserted.raw as { id: string }[] | undefined)?.[0]?.id;
    if (!alertId) {
      return;
    }
    try {
      await this.sendEmail(budget, period, spent);
    } catch (error) {
      // sin correo no hay aviso: se libera para que el cron lo reintente
      await this.alertsRepository.delete({ id: alertId });
      throw error;
    }
  }

  // notify nunca lanza
  private async notifyExceeded(
    budget: CategoryBudget,
    period: string,
    spent: number,
  ): Promise<void> {
    const money = moneyFormatter(budget.currency);
    const category = budget.category?.name ?? 'una categoría';
    await this.notifications.notify(budget.userId, {
      type: NotificationType.BUDGET_EXCEEDED,
      title: `Superaste tu presupuesto de ${category}`,
      body: `En ${formatPeriod(period)} llevas ${money(spent)} en ${category} y tu presupuesto es de ${money(budget.amount)}: te excediste en ${money(spent - budget.amount)}.`,
      link: '/presupuestos',
      dedupeKey: exceededKey(budget.id, period),
    });
  }

  private async notifyNear(
    budget: CategoryBudget,
    period: string,
    spent: number,
  ): Promise<void> {
    const money = moneyFormatter(budget.currency);
    const category = budget.category?.name ?? 'una categoría';
    const percentage = Math.floor((spent / budget.amount) * 100);
    await this.notifications.notify(budget.userId, {
      type: NotificationType.BUDGET_NEAR,
      title: `Vas en el ${percentage} % de tu presupuesto de ${category}`,
      body: `En ${formatPeriod(period)} llevas ${money(spent)} en ${category} de un presupuesto de ${money(budget.amount)}.`,
      link: '/presupuestos',
      dedupeKey: nearKey(budget.id, period),
    });
  }

  private async sendEmail(
    budget: CategoryBudget,
    period: string,
    spent: number,
  ): Promise<void> {
    const money = moneyFormatter(budget.currency);
    const category = escapeHtml(budget.category?.name ?? 'una categoría');
    const month = formatPeriod(period);
    await this.email.send(
      budget.user.email,
      `Superaste tu presupuesto de ${budget.category?.name ?? 'una categoría'}`,
      `<p>Hola ${escapeHtml(budget.user.firstName)},</p><p>En <strong>${month}</strong> llevas gastado <strong>${money(spent)}</strong> en <strong>${category}</strong>, y tu presupuesto es de <strong>${money(budget.amount)}</strong>.</p><p>Te excediste en <strong>${money(spent - budget.amount)}</strong>.</p>`,
    );
  }
}

function exceededKey(budgetId: string, period: string): string {
  return `budget-exceeded:${budgetId}:${period}`;
}

function nearKey(budgetId: string, period: string): string {
  return `budget-near:${budgetId}:${period}`;
}

// el mismo formato del correo, en la moneda base del presupuesto
function moneyFormatter(currency: string): (value: number) => string {
  return (value: number) =>
    value.toLocaleString('es-CO', { style: 'currency', currency });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

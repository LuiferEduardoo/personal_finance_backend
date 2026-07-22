import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Recurrence } from '../common/enums/recurrence.enum';
import { ExpenseItemInput } from '../transactions/dto/expense-item.input';
import { ExpensesService } from '../transactions/expenses.service';
import { CreateRecurringExpenseInput } from './dto/create-recurring-expense.input';
import { UpdateRecurringExpenseInput } from './dto/update-recurring-expense.input';
import { RecurringExpenseItem } from './entities/recurring-expense-item.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';

// meses a sumar por cada frecuencia (los que van en días se tratan aparte)
const MONTHS_BY_RECURRENCE: Partial<Record<Recurrence, number>> = {
  [Recurrence.MONTHLY]: 1,
  [Recurrence.BIMONTHLY]: 2,
  [Recurrence.QUARTERLY]: 3,
  [Recurrence.SEMIANNUAL]: 6,
  [Recurrence.ANNUAL]: 12,
};
const DAYS_BY_RECURRENCE: Partial<Record<Recurrence, number>> = {
  [Recurrence.DAILY]: 1,
  [Recurrence.WEEKLY]: 7,
  [Recurrence.BIWEEKLY]: 14,
};

@Injectable()
export class RecurringExpensesService {
  constructor(
    @InjectRepository(RecurringExpense)
    private readonly recurringRepository: Repository<RecurringExpense>,
    @InjectRepository(RecurringExpenseItem)
    private readonly recurringItemsRepository: Repository<RecurringExpenseItem>,
    private readonly articlesService: ArticlesService,
    private readonly expensesService: ExpensesService,
  ) {}

  findAll(
    userId: string,
    includeInactive = false,
  ): Promise<RecurringExpense[]> {
    return this.recurringRepository.find({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      relations: {
        category: true,
        paymentMethod: true,
        items: { article: true },
      },
      order: { nextRunOn: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<RecurringExpense> {
    const recurring = await this.recurringRepository.findOne({
      where: { id, userId },
      relations: {
        category: true,
        paymentMethod: true,
        items: { article: true },
      },
    });
    if (!recurring) {
      throw new NotFoundException(`Gasto recurrente ${id} no encontrado`);
    }
    return recurring;
  }

  async create(
    userId: string,
    input: CreateRecurringExpenseInput,
  ): Promise<RecurringExpense> {
    this.assertRecurring(input.recurrence);
    const { items, startOn, accountId, ...rest } = input;
    const itemEntities = await this.buildItems(userId, items);
    if (!itemEntities.length && input.amount == null) {
      throw new BadRequestException(
        'El gasto recurrente requiere un importe (amount) o al menos un ítem',
      );
    }
    const recurring = this.recurringRepository.create({
      ...rest,
      userId,
      paymentMethodId: accountId ?? null,
      startOn,
      nextRunOn: startOn,
      items: itemEntities,
    });
    const saved = await this.recurringRepository.save(recurring);
    return this.findOne(saved.id, userId);
  }

  async update(
    userId: string,
    input: UpdateRecurringExpenseInput,
  ): Promise<RecurringExpense> {
    const recurring = await this.findOne(input.id, userId);
    const { id, items, recurrence, accountId, ...changes } = input;
    if (recurrence) {
      this.assertRecurring(recurrence);
      recurring.recurrence = recurrence;
    }
    if (accountId !== undefined) {
      recurring.paymentMethodId = accountId;
    }
    if (items !== undefined) {
      await this.recurringItemsRepository.delete({ recurringExpenseId: id });
      recurring.items = await this.buildItems(userId, items);
    }
    Object.assign(recurring, changes);
    await this.recurringRepository.save(recurring);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const recurring = await this.findOne(id, userId);
    await this.recurringRepository.remove(recurring);
    return true;
  }

  /**
   * Materializa todos los gastos recurrentes vencidos hasta `today` (inclusive).
   * Devuelve cuántos gastos se generaron. Se llama desde el cron y desde la
   * mutation manual.
   */
  async runDue(
    today = new Date().toISOString().substring(0, 10),
  ): Promise<number> {
    const due = await this.recurringRepository.find({
      where: { isActive: true, nextRunOn: LessThanOrEqual(today) },
      relations: { items: true },
    });

    let generated = 0;
    for (const recurring of due) {
      // genera cada ocurrencia pendiente (soporta puesta al día)
      while (
        recurring.isActive &&
        recurring.nextRunOn <= today &&
        (!recurring.endOn || recurring.nextRunOn <= recurring.endOn)
      ) {
        await this.materialize(recurring);
        generated += 1;
        recurring.nextRunOn = this.addInterval(
          recurring.nextRunOn,
          recurring.recurrence,
        );
        if (recurring.endOn && recurring.nextRunOn > recurring.endOn) {
          recurring.isActive = false;
        }
      }
      await this.recurringRepository.save(recurring);
    }
    return generated;
  }

  private async materialize(recurring: RecurringExpense): Promise<void> {
    const items: ExpenseItemInput[] = recurring.items.map((item) => ({
      articleId: item.articleId ?? undefined,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      description: item.description ?? undefined,
    }));
    await this.expensesService.create({
      userId: recurring.userId,
      description: recurring.description,
      amount: items.length ? undefined : (recurring.amount ?? undefined),
      items: items.length ? items : undefined,
      currency: recurring.currency,
      exchangeRate: recurring.exchangeRate,
      occurredOn: recurring.nextRunOn,
      categoryId: recurring.categoryId ?? undefined,
      accountId: recurring.paymentMethodId ?? undefined,
      merchant: recurring.merchant ?? undefined,
      notes: recurring.notes ?? undefined,
    });
  }

  private async buildItems(
    userId: string,
    items?: ExpenseItemInput[],
  ): Promise<RecurringExpenseItem[]> {
    if (!items?.length) {
      return [];
    }
    return Promise.all(
      items.map(async (input) => {
        const article = await this.articlesService.resolveOrCreate(
          userId,
          input.articleId,
          input.newArticle,
        );
        return this.recurringItemsRepository.create({
          articleId: article.id,
          description: input.description ?? null,
          unitPrice: input.unitPrice,
          quantity: input.quantity ?? 1,
        });
      }),
    );
  }

  private assertRecurring(recurrence: Recurrence): void {
    if (recurrence === Recurrence.ONCE) {
      throw new BadRequestException(
        'La frecuencia de un gasto recurrente no puede ser ONCE',
      );
    }
  }

  // avanza una fecha YYYY-MM-DD según la frecuencia
  private addInterval(dateStr: string, recurrence: Recurrence): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const months = MONTHS_BY_RECURRENCE[recurrence];
    const days = DAYS_BY_RECURRENCE[recurrence];
    if (months) {
      date.setUTCMonth(date.getUTCMonth() + months);
    } else if (days) {
      date.setUTCDate(date.getUTCDate() + days);
    }
    return date.toISOString().substring(0, 10);
  }
}

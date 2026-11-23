import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import { User } from '../users/entities/user.entity';
import { BudgetAlertsService } from './budget-alerts.service';
import { currentPeriod, isValidPeriod } from './budget-period';
import { CategoryBudgetStatus } from './dto/category-budget-status';
import { SetCategoryBudgetInput } from './dto/set-category-budget.input';
import { CategoryBudget } from './entities/category-budget.entity';

@Injectable()
export class CategoryBudgetsService {
  constructor(
    @InjectRepository(CategoryBudget)
    private readonly budgetsRepository: Repository<CategoryBudget>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly alerts: BudgetAlertsService,
  ) {}

  // presupuestos del usuario con lo gastado en el mes (por defecto, el actual)
  async findAll(
    userId: string,
    month?: string,
  ): Promise<CategoryBudgetStatus[]> {
    const period = month ?? currentPeriod();
    if (!isValidPeriod(period)) {
      throw new BadRequestException('month debe tener el formato YYYY-MM');
    }
    const budgets = await this.budgetsRepository.find({
      where: { userId },
      relations: { category: true },
      order: { category: { name: 'ASC' } },
    });
    const spent = await this.alerts.spentByBudget(
      budgets.map((budget) => budget.id),
      period,
    );
    return budgets.map((budget) =>
      this.toStatus(budget, period, spent.get(budget.id) ?? 0),
    );
  }

  /**
   * Crea o actualiza el presupuesto de una categoría. Si el monto sube, se
   * borra el aviso del mes en curso para volver a avisar si se supera el
   * nuevo tope.
   */
  async set(
    userId: string,
    input: SetCategoryBudgetInput,
  ): Promise<CategoryBudgetStatus> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('El presupuesto debe ser mayor que 0');
    }
    const category = await this.findExpenseCategory(input.categoryId, userId);
    const currency = await this.baseCurrencyOf(userId);
    if (input.currency && input.currency.toUpperCase() !== currency) {
      throw new BadRequestException(
        `El presupuesto va en tu moneda base (${currency}): lo gastado se mide en ella`,
      );
    }
    const period = currentPeriod();

    const existing = await this.budgetsRepository.findOne({
      where: { userId, categoryId: category.id },
    });
    const raised = !!existing && input.amount > existing.amount;
    const budget =
      existing ??
      this.budgetsRepository.create({ userId, categoryId: category.id });
    budget.amount = input.amount;
    // siempre la moneda base: lo gastado se suma como amount * exchange_rate
    budget.currency = currency;
    const saved = await this.budgetsRepository.save(budget);
    if (raised) {
      await this.alerts.resetAlert(saved.id, period);
    }
    // si el nuevo monto ya está excedido, avisa sin hacer esperar la respuesta
    void this.alerts.checkBudget(saved.id);

    const spent = await this.alerts.spentByBudget([saved.id], period);
    saved.category = category;
    return this.toStatus(saved, period, spent.get(saved.id) ?? 0);
  }

  async remove(userId: string, categoryId: string): Promise<boolean> {
    const result = await this.budgetsRepository.delete({ userId, categoryId });
    if (!result.affected) {
      throw new NotFoundException(
        `No hay presupuesto para la categoría ${categoryId}`,
      );
    }
    return true;
  }

  private async baseCurrencyOf(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, baseCurrency: true },
    });
    return user?.baseCurrency ?? 'COP';
  }

  // las del sistema (userId null) las ve cualquiera; las propias, solo su dueño
  private async findExpenseCategory(
    categoryId: string,
    userId: string,
  ): Promise<Category> {
    const category = await this.categoriesRepository.findOne({
      where: [
        { id: categoryId, userId: IsNull() },
        { id: categoryId, userId },
      ],
    });
    if (!category) {
      throw new NotFoundException(`Categoría ${categoryId} no encontrada`);
    }
    if (category.kind !== TransactionKind.EXPENSE) {
      throw new BadRequestException(
        'Solo las categorías de gasto pueden tener presupuesto',
      );
    }
    return category;
  }

  private toStatus(
    budget: CategoryBudget,
    period: string,
    spent: number,
  ): CategoryBudgetStatus {
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      id: budget.id,
      category: budget.category,
      amount: budget.amount,
      currency: budget.currency,
      period,
      spent: round(spent),
      remaining: round(budget.amount - spent),
      percentage: round((spent / budget.amount) * 100),
      exceeded: spent > budget.amount,
    };
  }
}

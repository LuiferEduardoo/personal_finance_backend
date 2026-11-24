import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  DataSource,
  EntityManager,
  Repository,
} from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { BudgetAlertsService } from '../budgets/budget-alerts.service';
import { Article, ArticleType } from '../articles/entities/article.entity';
import { resolveDiscount } from '../common/discount';
import { Recurrence } from '../common/enums/recurrence.enum';
import {
  calculateInstallments,
  roundToCents,
} from '../installments/installment-calculator';
import { InstallmentPlan } from '../installments/entities/installment-plan.entity';
import { Installment } from '../installments/entities/installment.entity';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PurchasesService } from '../products/purchases.service';
import { CreateExpenseInput } from './dto/create-expense.input';
import { ExpenseItemInput } from './dto/expense-item.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { ExpenseItem } from './entities/expense-item.entity';
import { Expense } from './entities/expense.entity';

// ítem ya con su artículo resuelto y su descuento pasado a importe
interface ResolvedItem {
  article: Article;
  input: ExpenseItemInput;
  discount: number;
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(ExpenseItem)
    private readonly expenseItemsRepository: Repository<ExpenseItem>,
    @InjectRepository(InstallmentPlan)
    private readonly installmentPlansRepository: Repository<InstallmentPlan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    private readonly articlesService: ArticlesService,
    private readonly purchasesService: PurchasesService,
    private readonly accountsService: PaymentMethodsService,
    private readonly dataSource: DataSource,
    private readonly budgetAlerts: BudgetAlertsService,
  ) {}

  findAll(
    userId: string,
    filter?: TransactionsFilterInput,
  ): Promise<Expense[]> {
    const where: FindOptionsWhere<Expense> = { userId };
    if (filter?.from && filter?.to) {
      where.occurredOn = Between(filter.from, filter.to);
    } else if (filter?.from) {
      where.occurredOn = MoreThanOrEqual(filter.from);
    } else if (filter?.to) {
      where.occurredOn = LessThanOrEqual(filter.to);
    }
    if (filter?.categoryId) {
      where.categoryId = filter.categoryId;
    }
    if (filter?.accountId) {
      where.paymentMethodId = filter.accountId;
    }
    return this.expensesRepository.find({
      where,
      relations: {
        category: true,
        paymentMethod: true,
        plan: true,
        installment: true,
        items: { article: true },
      },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id, userId },
      relations: {
        category: true,
        paymentMethod: true,
        plan: true,
        installment: true,
        items: { article: true },
      },
    });
    if (!expense) {
      throw new NotFoundException(`Gasto ${id} no encontrado`);
    }
    return expense;
  }

  async create(userId: string, input: CreateExpenseInput): Promise<Expense> {
    const {
      items,
      amount,
      categoryId,
      accountId,
      installmentCount = 1,
      monthlyInterestRate = 0,
      ...rest
    } = input;
    const resolved = await this.resolveItems(userId, items);
    const finalAmount = this.resolveAmount(amount, resolved);

    this.validateInstallmentInput(installmentCount, monthlyInterestRate);

    // la cuenta debe ser del usuario, y con crédito hay que respetar el cupo
    await this.accountsService.assertOwned(accountId, userId);
    if (installmentCount > 1 && !accountId) {
      throw new BadRequestException(
        'Una compra a cuotas requiere una cuenta (accountId)',
      );
    }
    if (
      installmentCount > 1 &&
      rest.recurrence &&
      rest.recurrence !== Recurrence.ONCE
    ) {
      throw new BadRequestException(
        'Una compra a cuotas no puede ser además un gasto recurrente',
      );
    }

    if (installmentCount > 1) {
      const first = await this.createInInstallments(
        userId,
        {
          ...rest,
          amount: finalAmount,
          categoryId: this.resolveCategory(categoryId, resolved),
          accountId: accountId!,
          installmentCount,
          monthlyInterestRate,
        },
        resolved,
      );
      // las cuotas de meses futuros las revisa el cron cuando llegue su mes
      this.checkBudgets(userId, first);
      return first;
    }

    if (accountId) {
      await this.accountsService.assertCreditAvailable(accountId, finalAmount);
    }

    const expense = this.expensesRepository.create({
      ...rest,
      userId,
      paymentMethodId: accountId ?? null,
      categoryId: this.resolveCategory(categoryId, resolved),
      amount: finalAmount,
      items: resolved.map((r) => this.buildItem(r)),
    });
    const saved = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(Expense, expense);
      await this.accountsService.adjustBalance(
        accountId ?? null,
        -finalAmount,
        manager,
      );
      await this.registerInventoryPurchases(userId, created, resolved, manager);
      return created;
    });

    const result = await this.findOne(saved.id, userId);
    this.checkBudgets(userId, result);
    return result;
  }

  async update(userId: string, input: UpdateExpenseInput): Promise<Expense> {
    const expense = await this.findOne(input.id, userId);
    if (expense.planId) {
      // cualquier cuota edita la compra entera (el plan)
      return this.updateInstallmentPurchase(userId, expense, input);
    }
    // estado previo para ajustar el saldo
    const prevAccountId = expense.paymentMethodId;
    const prevAmount = expense.amount;

    const {
      id,
      items,
      amount,
      categoryId,
      accountId,
      installmentCount,
      monthlyInterestRate,
      ...changes
    } = input;
    if (installmentCount !== undefined || monthlyInterestRate !== undefined) {
      throw new BadRequestException(
        'La configuración de cuotas solo se puede indicar al crear la compra',
      );
    }
    if (accountId !== undefined) {
      await this.accountsService.assertOwned(accountId, userId);
      expense.paymentMethodId = accountId;
    }

    let resolvedItems: ResolvedItem[] | undefined;
    if (items !== undefined) {
      // reemplazo total de ítems (no re-dispara inventario, para no duplicar ciclos)
      resolvedItems = await this.resolveItems(userId, items);
      expense.items = resolvedItems.map((r) => this.buildItem(r));
      expense.amount = this.resolveAmount(amount, resolvedItems);
      if (categoryId === undefined) {
        expense.categoryId = this.resolveCategory(
          expense.categoryId,
          resolvedItems,
        );
      }
    } else if (amount !== undefined) {
      expense.amount = roundToCents(amount);
    }
    if (categoryId !== undefined) {
      expense.categoryId = categoryId;
    }

    // ajuste de saldo: revierte el movimiento previo y aplica el nuevo
    const accountChanged = expense.paymentMethodId !== prevAccountId;
    const amountChanged = expense.amount !== prevAmount;
    Object.assign(expense, changes);
    await this.dataSource.transaction(async (manager) => {
      if (resolvedItems) {
        await manager.delete(ExpenseItem, { expenseId: id });
      }
      if (accountChanged || amountChanged) {
        await this.accountsService.adjustBalance(
          prevAccountId,
          prevAmount,
          manager,
        );
        if (expense.paymentMethodId) {
          await this.accountsService.assertCreditAvailable(
            expense.paymentMethodId,
            expense.amount,
            manager,
          );
        }
        await this.accountsService.adjustBalance(
          expense.paymentMethodId,
          -expense.amount,
          manager,
        );
      }
      await manager.save(Expense, expense);
    });
    const result = await this.findOne(id, userId);
    this.checkBudgets(userId, result);
    return result;
  }

  /**
   * Edita una compra a cuotas completa desde cualquiera de sus gastos. En el
   * input, `description` es la base (sin " (n/N)"), `amount`/`items` el
   * capital y `occurredOn` la fecha de compra. Siempre recalcula la tabla con
   * `calculateInstallments` y actualiza en sitio las cuotas cuya secuencia
   * sigue existiendo (conserva los ids, a los que apuntan inventario y
   * correo), borra las sobrantes y crea las que falten: el resultado es igual
   * a crearla de nuevo. Como nada cambia aún el estado de las cuotas, se
   * puede regenerar todo el plan. Los ítems, igual que al crear, solo dan el
   * importe (no se guardan en las cuotas) y no re-disparan el inventario.
   */
  private async updateInstallmentPurchase(
    userId: string,
    expense: Expense,
    input: UpdateExpenseInput,
  ): Promise<Expense> {
    const {
      items,
      amount,
      categoryId,
      accountId,
      installmentCount,
      monthlyInterestRate,
      occurredOn,
      description,
      recurrence,
      merchant,
      notes,
      receiptUrl,
      currency,
      exchangeRate,
    } = input;
    if (recurrence != null && recurrence !== Recurrence.ONCE) {
      throw new BadRequestException(
        'Una compra a cuotas no puede ser además un gasto recurrente',
      );
    }
    if (accountId === null) {
      throw new BadRequestException(
        'Una compra a cuotas requiere una cuenta (accountId)',
      );
    }

    const plan = await this.installmentPlansRepository.findOne({
      where: { id: expense.planId!, userId },
    });
    if (!plan) {
      throw new NotFoundException(
        `Compra a cuotas ${expense.planId} no encontrada`,
      );
    }
    const oldExpenses = (
      await this.expensesRepository.find({
        where: { planId: plan.id, userId },
        relations: { installment: true },
      })
    ).sort(
      (a, b) =>
        (a.installment?.sequenceNumber ?? 0) -
          (b.installment?.sequenceNumber ?? 0) ||
        a.occurredOn.localeCompare(b.occurredOn),
    );

    const count = installmentCount ?? plan.installmentCount;
    const rate = monthlyInterestRate ?? plan.monthlyRate;
    this.validateInstallmentInput(count, rate);
    if (accountId !== undefined) {
      await this.accountsService.assertOwned(accountId, userId);
    }
    const prevAccountId = plan.paymentMethodId;
    const nextAccountId = accountId ?? prevAccountId;

    let principal = plan.principalAmount;
    let resolvedItems: ResolvedItem[] | undefined;
    if (items != null) {
      resolvedItems = await this.resolveItems(userId, items);
      principal = this.resolveAmount(amount ?? undefined, resolvedItems);
    } else if (amount != null) {
      principal = roundToCents(amount);
    }
    const first = oldExpenses[0] ?? expense;
    let nextCategoryId: string | null =
      categoryId !== undefined ? categoryId : first.categoryId;
    if (categoryId === undefined && resolvedItems) {
      nextCategoryId = this.resolveCategory(nextCategoryId, resolvedItems);
    }
    const purchaseDate = occurredOn ?? plan.purchaseDate;
    const baseDescription = description ?? plan.description;
    // campos que comparten todas las cuotas
    const shared = {
      paymentMethodId: nextAccountId,
      categoryId: nextCategoryId,
      merchant: merchant !== undefined ? merchant : first.merchant,
      notes: notes !== undefined ? notes : first.notes,
      receiptUrl: receiptUrl !== undefined ? receiptUrl : first.receiptUrl,
      currency: currency ?? first.currency,
      exchangeRate: exchangeRate ?? first.exchangeRate,
    };

    const schedule = calculateInstallments(
      principal,
      count,
      rate,
      purchaseDate,
    );
    const toCents = (value: number) => Math.round(value * 100);
    const newTotal =
      schedule.reduce((sum, part) => sum + toCents(part.amount), 0) / 100;
    const oldTotal =
      oldExpenses.reduce((sum, item) => sum + toCents(item.amount), 0) / 100;
    const moveBalance =
      nextAccountId !== prevAccountId ||
      toCents(newTotal) !== toCents(oldTotal);

    await this.dataSource.transaction(async (manager) => {
      // primero el saldo: si no hay cupo, nada se escribe (y se revierte)
      if (moveBalance) {
        await this.accountsService.adjustBalance(
          prevAccountId,
          oldTotal,
          manager,
        );
        await this.accountsService.assertCreditAvailable(
          nextAccountId,
          newTotal,
          manager,
        );
        await this.accountsService.adjustBalance(
          nextAccountId,
          -newTotal,
          manager,
        );
      }

      await manager.update(InstallmentPlan, plan.id, {
        paymentMethodId: nextAccountId,
        description: baseDescription,
        totalAmount: newTotal,
        principalAmount: principal,
        installmentCount: count,
        monthlyRate: rate,
        purchaseDate,
        firstDueDate: purchaseDate,
      });

      const surplus = oldExpenses.slice(count);
      if (surplus.length) {
        await manager.delete(Expense, { id: In(surplus.map((e) => e.id)) });
        const surplusInstallments = surplus
          .map((e) => e.installmentId)
          .filter((value): value is string => value != null);
        if (surplusInstallments.length) {
          await manager.delete(Installment, { id: In(surplusInstallments) });
        }
      }

      for (const [index, part] of schedule.entries()) {
        const fields = {
          ...shared,
          description: `${baseDescription} (${part.sequenceNumber}/${count})`,
          amount: part.amount,
          occurredOn: part.dueDate,
        };
        const current = oldExpenses[index];
        if (current?.installmentId) {
          await manager.update(Installment, current.installmentId, part);
          await manager.update(Expense, current.id, fields);
          continue;
        }
        const installment = await manager.save(
          Installment,
          this.installmentsRepository.create({ planId: plan.id, ...part }),
        );
        if (current) {
          await manager.update(Expense, current.id, {
            ...fields,
            installmentId: installment.id,
          });
          continue;
        }
        await manager.save(
          Expense,
          this.expensesRepository.create({
            ...fields,
            userId,
            planId: plan.id,
            installmentId: installment.id,
            recurrence: Recurrence.ONCE,
          }),
        );
      }
    });

    // presupuestos de los meses que tocaba y de los que toca ahora
    const checks = new Map<string, [string | null, string]>();
    for (const old of oldExpenses) {
      checks.set(`${old.categoryId}|${old.occurredOn.substring(0, 7)}`, [
        old.categoryId,
        old.occurredOn,
      ]);
    }
    for (const part of schedule) {
      checks.set(`${nextCategoryId}|${part.dueDate.substring(0, 7)}`, [
        nextCategoryId,
        part.dueDate,
      ]);
    }
    for (const [category, date] of checks.values()) {
      this.budgetAlerts.scheduleExpenseCheck(userId, category, date);
    }

    // la cuota editada si sigue existiendo; si no, la primera
    const keepsEdited =
      oldExpenses.findIndex((e) => e.id === expense.id) < count;
    return this.findOne(keepsEdited ? expense.id : first.id, userId);
  }

  /**
   * Cambia la categoría de un gasto solo si sigue siendo `expected` (la que
   * tenía al registrarse). Lo usa la clasificación en segundo plano: si el
   * usuario la editó entretanto, la suya gana. La categoría no interviene en
   * saldos, cuotas ni inventario (las métricas por categoría se calculan al
   * consultar), así que no hay nada más que ajustar. Devuelve si la cambió.
   */
  async updateCategoryIfUnchanged(
    userId: string,
    id: string,
    expected: string | null,
    categoryId: string | null,
  ): Promise<boolean> {
    const result = await this.expensesRepository
      .createQueryBuilder()
      .update(Expense)
      .set({ categoryId })
      .where('"id" = :id', { id })
      .andWhere('"user_id" = :userId', { userId })
      .andWhere('"category_id" IS NOT DISTINCT FROM CAST(:expected AS uuid)', {
        expected,
      })
      .execute();
    const changed = (result.affected ?? 0) > 0;
    if (changed && categoryId) {
      const expense = await this.expensesRepository.findOne({
        select: { id: true, occurredOn: true },
        where: { id, userId },
      });
      if (expense) {
        this.budgetAlerts.scheduleExpenseCheck(
          userId,
          categoryId,
          expense.occurredOn,
        );
      }
    }
    return changed;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const expense = await this.findOne(id, userId);
    if (expense.planId) {
      const planExpenses = await this.expensesRepository.find({
        where: { planId: expense.planId, userId },
      });
      const total = planExpenses.reduce((sum, item) => sum + item.amount, 0);
      await this.dataSource.transaction(async (manager) => {
        await this.accountsService.adjustBalance(
          expense.paymentMethodId,
          total,
          manager,
        );
        await manager.remove(Expense, planExpenses);
        await manager.delete(InstallmentPlan, { id: expense.planId! });
      });
      return true;
    }
    // devuelve el importe a la cuenta
    await this.dataSource.transaction(async (manager) => {
      await this.accountsService.adjustBalance(
        expense.paymentMethodId,
        expense.amount,
        manager,
      );
      await manager.remove(Expense, expense);
    });
    return true;
  }

  // avisos de presupuesto en segundo plano: nunca bloquean ni hacen fallar el
  // registro del gasto
  private checkBudgets(userId: string, expense: Expense): void {
    this.budgetAlerts.scheduleExpenseCheck(
      userId,
      expense.categoryId,
      expense.occurredOn,
    );
  }

  private validateInstallmentInput(
    installmentCount: number,
    monthlyInterestRate: number,
  ): void {
    if (
      !Number.isInteger(installmentCount) ||
      installmentCount < 1 ||
      installmentCount > 120
    ) {
      throw new BadRequestException(
        'installmentCount debe ser un entero entre 1 y 120',
      );
    }
    if (
      !Number.isFinite(monthlyInterestRate) ||
      monthlyInterestRate < 0 ||
      monthlyInterestRate > 99.9999
    ) {
      throw new BadRequestException(
        'monthlyInterestRate debe ser un decimal entre 0 y 99.9999',
      );
    }
    if (installmentCount === 1 && monthlyInterestRate !== 0) {
      throw new BadRequestException(
        'monthlyInterestRate solo aplica cuando installmentCount es mayor que 1',
      );
    }
  }

  private async createInInstallments(
    userId: string,
    input: Omit<CreateExpenseInput, 'items'> & {
      amount: number;
      categoryId: string | null;
      accountId: string;
      installmentCount: number;
      monthlyInterestRate: number;
    },
    resolvedItems: ResolvedItem[],
  ): Promise<Expense> {
    const schedule = calculateInstallments(
      input.amount,
      input.installmentCount,
      input.monthlyInterestRate,
      input.occurredOn,
    );
    // en centavos: una suma de floats (0.1 + 0.2) falsearía la validación del cupo
    const financedTotal =
      schedule.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) /
      100;
    await this.accountsService.assertCreditAvailable(
      input.accountId,
      financedTotal,
    );

    const firstExpenseId = await this.dataSource.transaction(
      async (manager) => {
        const plan = await manager.save(
          InstallmentPlan,
          this.installmentPlansRepository.create({
            userId,
            paymentMethodId: input.accountId,
            description: input.description,
            totalAmount: financedTotal,
            principalAmount: input.amount,
            installmentCount: input.installmentCount,
            monthlyRate: input.monthlyInterestRate,
            purchaseDate: input.occurredOn,
            firstDueDate: input.occurredOn,
          }),
        );

        let firstExpense: Expense | undefined;
        for (const part of schedule) {
          const installment = await manager.save(
            Installment,
            this.installmentsRepository.create({
              planId: plan.id,
              ...part,
            }),
          );
          const expense = await manager.save(
            Expense,
            this.expensesRepository.create({
              userId,
              paymentMethodId: input.accountId,
              categoryId: input.categoryId,
              planId: plan.id,
              installmentId: installment.id,
              description: `${input.description} (${part.sequenceNumber}/${input.installmentCount})`,
              amount: part.amount,
              currency: input.currency,
              exchangeRate: input.exchangeRate,
              occurredOn: part.dueDate,
              merchant: input.merchant,
              notes: input.notes,
              receiptUrl: input.receiptUrl,
              recurrence: input.recurrence,
            }),
          );
          firstExpense ??= expense;
        }

        await this.accountsService.adjustBalance(
          input.accountId,
          -financedTotal,
          manager,
        );
        await this.registerInventoryPurchases(
          userId,
          firstExpense!,
          resolvedItems,
          manager,
        );
        return firstExpense!.id;
      },
    );

    return this.findOne(firstExpenseId, userId);
  }

  private async resolveItems(
    userId: string,
    items?: ExpenseItemInput[],
  ): Promise<ResolvedItem[]> {
    if (!items?.length) {
      return [];
    }
    return Promise.all(
      items.map(async (input) => ({
        article: await this.articlesService.resolveOrCreate(
          userId,
          input.articleId,
          input.newArticle,
        ),
        input,
        discount: resolveDiscount(
          input.unitPrice * (input.quantity ?? 1),
          input,
        ),
      })),
    );
  }

  private buildItem(resolved: ResolvedItem): ExpenseItem {
    return this.expenseItemsRepository.create({
      articleId: resolved.article.id,
      description: resolved.input.description ?? null,
      unitPrice: resolved.input.unitPrice,
      quantity: resolved.input.quantity ?? 1,
      discount: resolved.discount,
    });
  }

  // importe = suma de subtotales netos (ya con descuento) de los ítems;
  // si no hay ítems, del input
  private resolveAmount(
    amount: number | undefined,
    items: ResolvedItem[],
  ): number {
    if (items.length) {
      return roundToCents(
        items.reduce(
          (sum, r) =>
            sum + r.input.unitPrice * (r.input.quantity ?? 1) - r.discount,
          0,
        ),
      );
    }
    if (amount == null) {
      throw new BadRequestException(
        'El gasto requiere un importe (amount) o al menos un ítem',
      );
    }
    return roundToCents(amount);
  }

  // con un solo ítem se hereda la categoría del artículo si no se envió
  private resolveCategory(
    categoryId: string | null | undefined,
    items: ResolvedItem[],
  ): string | null {
    if (categoryId) {
      return categoryId;
    }
    if (items.length === 1) {
      return items[0].article.categoryId;
    }
    return categoryId ?? null;
  }

  private async registerInventoryPurchases(
    userId: string,
    expense: Expense,
    items: ResolvedItem[],
    manager: EntityManager,
  ): Promise<void> {
    for (const { article, input, discount } of items) {
      if (article.type !== ArticleType.PRODUCT) {
        continue;
      }
      await this.purchasesService.registerPurchaseForArticle(
        userId,
        article,
        {
          quantity: input.quantity ?? 1,
          unitPrice: input.unitPrice,
          discount,
          store: expense.merchant,
          purchasedOn: expense.occurredOn,
          expenseId: expense.id,
        },
        manager,
      );
    }
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  DataSource,
  EntityManager,
  Repository,
} from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article, ArticleType } from '../articles/entities/article.entity';
import { resolveDiscount } from '../common/discount';
import { Recurrence } from '../common/enums/recurrence.enum';
import { calculateInstallments } from '../installments/installment-calculator';
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
      return this.createInInstallments(
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

    return this.findOne(saved.id, userId);
  }

  async update(userId: string, input: UpdateExpenseInput): Promise<Expense> {
    const expense = await this.findOne(input.id, userId);
    if (expense.planId) {
      throw new BadRequestException(
        'Las compras a cuotas no se pueden editar parcialmente; elimínala y créala de nuevo',
      );
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
      expense.amount = amount;
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
    return this.findOne(id, userId);
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
    const financedTotal = schedule.reduce((sum, item) => sum + item.amount, 0);
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
      return items.reduce(
        (sum, r) =>
          sum + r.input.unitPrice * (r.input.quantity ?? 1) - r.discount,
        0,
      );
    }
    if (amount == null) {
      throw new BadRequestException(
        'El gasto requiere un importe (amount) o al menos un ítem',
      );
    }
    return amount;
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

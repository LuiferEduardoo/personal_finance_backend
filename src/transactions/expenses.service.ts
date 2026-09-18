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
        items: { article: true },
      },
    });
    if (!expense) {
      throw new NotFoundException(`Gasto ${id} no encontrado`);
    }
    return expense;
  }

  async create(userId: string, input: CreateExpenseInput): Promise<Expense> {
    const { items, amount, categoryId, accountId, ...rest } = input;
    const resolved = await this.resolveItems(userId, items);
    const finalAmount = this.resolveAmount(amount, resolved);

    // la cuenta debe ser del usuario, y con crédito hay que respetar el cupo
    await this.accountsService.assertOwned(accountId, userId);
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
    // estado previo para ajustar el saldo
    const prevAccountId = expense.paymentMethodId;
    const prevAmount = expense.amount;

    const { id, items, amount, categoryId, accountId, ...changes } = input;
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

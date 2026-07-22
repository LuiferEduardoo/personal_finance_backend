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
  Repository,
} from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article, ArticleType } from '../articles/entities/article.entity';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PurchasesService } from '../products/purchases.service';
import { CreateExpenseInput } from './dto/create-expense.input';
import { ExpenseItemInput } from './dto/expense-item.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { ExpenseItem } from './entities/expense-item.entity';
import { Expense } from './entities/expense.entity';

// ítem ya con su artículo resuelto
interface ResolvedItem {
  article: Article;
  input: ExpenseItemInput;
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

  async findOne(id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id },
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

  async create(input: CreateExpenseInput): Promise<Expense> {
    const { items, amount, categoryId, accountId, ...rest } = input;
    const resolved = await this.resolveItems(rest.userId, items);
    const finalAmount = this.resolveAmount(amount, resolved);

    // control de cupo antes de guardar (si la cuenta es de crédito)
    if (accountId) {
      await this.accountsService.assertCreditAvailable(accountId, finalAmount);
    }

    const expense = this.expensesRepository.create({
      ...rest,
      paymentMethodId: accountId ?? null,
      categoryId: this.resolveCategory(categoryId, resolved),
      amount: finalAmount,
      items: resolved.map((r) => this.buildItem(r)),
    });
    const saved = await this.expensesRepository.save(expense);

    // el gasto sale de la cuenta: baja el saldo
    await this.accountsService.adjustBalance(accountId ?? null, -finalAmount);

    // inventario: cada ítem tipo producto entra al stock ("hay")
    await this.registerInventoryPurchases(rest.userId, saved, resolved);

    return this.findOne(saved.id);
  }

  async update(input: UpdateExpenseInput): Promise<Expense> {
    const expense = await this.findOne(input.id);
    // estado previo para ajustar el saldo
    const prevAccountId = expense.paymentMethodId;
    const prevAmount = expense.amount;

    const { id, items, amount, categoryId, accountId, ...changes } = input;
    if (accountId !== undefined) {
      expense.paymentMethodId = accountId;
    }

    if (items !== undefined) {
      // reemplazo total de ítems (no re-dispara inventario, para no duplicar ciclos)
      const resolved = await this.resolveItems(expense.userId, items);
      await this.expenseItemsRepository.delete({ expenseId: id });
      expense.items = resolved.map((r) => this.buildItem(r));
      expense.amount = this.resolveAmount(amount, resolved);
      if (categoryId === undefined) {
        expense.categoryId = this.resolveCategory(expense.categoryId, resolved);
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
    if (accountChanged || amountChanged) {
      await this.accountsService.adjustBalance(prevAccountId, prevAmount);
      if (expense.paymentMethodId) {
        await this.accountsService.assertCreditAvailable(
          expense.paymentMethodId,
          expense.amount,
        );
      }
      await this.accountsService.adjustBalance(
        expense.paymentMethodId,
        -expense.amount,
      );
    }

    Object.assign(expense, changes);
    await this.expensesRepository.save(expense);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const expense = await this.findOne(id);
    // devuelve el importe a la cuenta
    await this.accountsService.adjustBalance(
      expense.paymentMethodId,
      expense.amount,
    );
    await this.expensesRepository.remove(expense);
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
      })),
    );
  }

  private buildItem(resolved: ResolvedItem): ExpenseItem {
    return this.expenseItemsRepository.create({
      articleId: resolved.article.id,
      description: resolved.input.description ?? null,
      unitPrice: resolved.input.unitPrice,
      quantity: resolved.input.quantity ?? 1,
    });
  }

  // importe = suma de subtotales de los ítems; si no hay ítems, del input
  private resolveAmount(
    amount: number | undefined,
    items: ResolvedItem[],
  ): number {
    if (items.length) {
      return items.reduce(
        (sum, r) => sum + r.input.unitPrice * (r.input.quantity ?? 1),
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
  ): Promise<void> {
    for (const { article, input } of items) {
      if (article.type !== ArticleType.PRODUCT) {
        continue;
      }
      await this.purchasesService.registerPurchaseForArticle(userId, article, {
        quantity: input.quantity ?? 1,
        unitPrice: input.unitPrice,
        store: expense.merchant,
        purchasedOn: expense.occurredOn,
        expenseId: expense.id,
      });
    }
  }
}

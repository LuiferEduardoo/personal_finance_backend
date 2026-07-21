import { Injectable, NotFoundException } from '@nestjs/common';
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
import { PurchasesService } from '../products/purchases.service';
import { CreateExpenseInput } from './dto/create-expense.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { Expense } from './entities/expense.entity';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    private readonly articlesService: ArticlesService,
    private readonly purchasesService: PurchasesService,
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
    if (filter?.paymentMethodId) {
      where.paymentMethodId = filter.paymentMethodId;
    }
    return this.expensesRepository.find({
      where,
      relations: { category: true, article: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id },
      relations: { category: true, article: true },
    });
    if (!expense) {
      throw new NotFoundException(`Gasto ${id} no encontrado`);
    }
    return expense;
  }

  async create(input: CreateExpenseInput): Promise<Expense> {
    const { articleId, newArticle, ...rest } = input;

    const article =
      articleId || newArticle
        ? await this.articlesService.resolveOrCreate(
            rest.userId,
            articleId,
            newArticle,
          )
        : null;

    const expense = this.expensesRepository.create({
      ...rest,
      articleId: article?.id ?? null,
    });
    const saved = await this.expensesRepository.save(expense);

    // si el artículo es tipo producto, entra al inventario: crea/vincula el
    // product, registra la compra y reabre el ciclo ("hay") si estaba agotado
    if (article?.type === ArticleType.PRODUCT) {
      await this.registerInventoryPurchase(rest.userId, article, saved);
    }

    return this.findOne(saved.id);
  }

  async update(input: UpdateExpenseInput): Promise<Expense> {
    const expense = await this.findOne(input.id);
    const { id, articleId, newArticle, ...changes } = input;

    if (articleId || newArticle) {
      const article = await this.articlesService.resolveOrCreate(
        expense.userId,
        articleId,
        newArticle,
      );
      expense.articleId = article.id;
    }
    Object.assign(expense, changes);
    await this.expensesRepository.save(expense);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const expense = await this.findOne(id);
    await this.expensesRepository.remove(expense);
    return true;
  }

  private registerInventoryPurchase(
    userId: string,
    article: Article,
    expense: Expense,
  ): Promise<unknown> {
    return this.purchasesService.registerPurchaseForArticle(userId, article, {
      quantity: expense.quantity,
      unitPrice: expense.quantity ? expense.amount / expense.quantity : null,
      store: expense.merchant,
      purchasedOn: expense.occurredOn,
      expenseId: expense.id,
    });
  }
}

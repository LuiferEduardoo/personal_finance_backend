import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article } from '../articles/entities/article.entity';
import {
  ListItemStatus,
  ShoppingListItem,
} from '../shopping-lists/entities/shopping-list-item.entity';
import { ShoppingList } from '../shopping-lists/entities/shopping-list.entity';
import { RegisterProductPurchaseInput } from './dto/register-product-purchase.input';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';

// datos de una compra ya con el artículo resuelto
interface PurchaseData {
  quantity?: number;
  unitPrice?: number | null;
  store?: string | null;
  purchasedOn: string;
  expenseId?: string | null;
  notes?: string | null;
}

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(ProductPurchase)
    private readonly purchasesRepository: Repository<ProductPurchase>,
    @InjectRepository(ConsumptionCycle)
    private readonly cyclesRepository: Repository<ConsumptionCycle>,
    @InjectRepository(ShoppingList)
    private readonly shoppingListsRepository: Repository<ShoppingList>,
    @InjectRepository(ShoppingListItem)
    private readonly shoppingListItemsRepository: Repository<ShoppingListItem>,
    private readonly articlesService: ArticlesService,
  ) {}

  findPurchases(
    userId: string,
    articleId?: string,
  ): Promise<ProductPurchase[]> {
    return this.purchasesRepository.find({
      where: { userId, ...(articleId ? { articleId } : {}) },
      relations: { article: true },
      order: { purchasedOn: 'DESC', createdAt: 'DESC' },
    });
  }

  findCycles(userId: string, articleId: string): Promise<ConsumptionCycle[]> {
    return this.cyclesRepository.find({
      where: { userId, articleId },
      relations: { article: true },
      order: { startedOn: 'DESC' },
    });
  }

  hasOpenCycle(articleId: string): Promise<boolean> {
    return this.cyclesRepository.exists({
      where: { articleId, depletedOn: IsNull() },
    });
  }

  /**
   * Registra una compra. Si el artículo es consumible y no tiene ciclo
   * abierto, abre uno nuevo ("hay Shampoo"), y marca como comprados los
   * ítems pendientes de la lista de compras para ese artículo.
   */
  async registerPurchase(
    userId: string,
    input: RegisterProductPurchaseInput,
  ): Promise<ProductPurchase> {
    const article = await this.articlesService.resolveOrCreate(
      userId,
      input.articleId,
      input.newArticle,
    );
    return this.recordPurchase(userId, article, input);
  }

  /**
   * Registra la compra de un artículo tipo producto (disparado al crear un
   * gasto). Aplica la lógica de ciclos y lista de compras.
   */
  registerPurchaseForArticle(
    userId: string,
    article: Article,
    data: PurchaseData,
  ): Promise<ProductPurchase> {
    return this.recordPurchase(userId, article, data);
  }

  // cuerpo común: crea la compra, abre ciclo si aplica y sincroniza la lista
  private async recordPurchase(
    userId: string,
    article: Article,
    data: PurchaseData,
  ): Promise<ProductPurchase> {
    const purchase = await this.purchasesRepository.save(
      this.purchasesRepository.create({
        userId,
        articleId: article.id,
        quantity: data.quantity ?? 1,
        unitPrice: data.unitPrice ?? null,
        store: data.store ?? null,
        purchasedOn: data.purchasedOn,
        expenseId: data.expenseId ?? null,
        notes: data.notes ?? null,
      }),
    );

    // "hay Shampoo": abre ciclo de consumo si es consumible y no hay uno abierto
    if (article.isConsumable && !(await this.hasOpenCycle(article.id))) {
      await this.cyclesRepository.save(
        this.cyclesRepository.create({
          userId,
          articleId: article.id,
          purchaseId: purchase.id,
          startedOn: data.purchasedOn,
          quantity: data.quantity ?? 1,
        }),
      );
    }

    // marca como comprados los ítems pendientes de las listas del usuario
    await this.markPendingListItemsPurchased(userId, article.id, purchase.id);

    const saved = await this.purchasesRepository.findOne({
      where: { id: purchase.id },
      relations: { article: true },
    });
    return saved!;
  }

  /**
   * "Se acabó": cierra el ciclo abierto y agrega el artículo a la lista
   * de compras (autoAdded) si no está ya pendiente.
   */
  async markDepleted(
    userId: string,
    articleId: string,
    depletedOn?: string,
  ): Promise<Article> {
    const article = await this.articlesService.findOne(articleId, userId);

    const openCycle = await this.cyclesRepository.findOne({
      where: { articleId, depletedOn: IsNull() },
    });
    if (!openCycle) {
      throw new BadRequestException(
        'El artículo no tiene un ciclo de consumo abierto',
      );
    }

    const depletionDate =
      depletedOn ?? new Date().toISOString().substring(0, 10);
    // el check cycles_date_order exige depleted_on >= started_on
    openCycle.depletedOn =
      depletionDate < openCycle.startedOn ? openCycle.startedOn : depletionDate;
    await this.cyclesRepository.save(openCycle);

    await this.addToShoppingList(userId, articleId);
    return article;
  }

  private async markPendingListItemsPurchased(
    userId: string,
    articleId: string,
    purchaseId: string,
  ): Promise<void> {
    const pendingItems = await this.shoppingListItemsRepository.find({
      where: {
        articleId,
        status: ListItemStatus.PENDING,
        list: { userId },
      },
      relations: { list: true },
    });
    for (const item of pendingItems) {
      item.status = ListItemStatus.PURCHASED;
      item.productPurchaseId = purchaseId;
      await this.shoppingListItemsRepository.save(item);
    }
  }

  private async addToShoppingList(
    userId: string,
    articleId: string,
  ): Promise<void> {
    const alreadyPending = await this.shoppingListItemsRepository.exists({
      where: {
        articleId,
        status: ListItemStatus.PENDING,
        list: { userId, isArchived: false },
      },
    });
    if (alreadyPending) {
      return;
    }

    let list = await this.shoppingListsRepository.findOne({
      where: { userId, isArchived: false },
      order: { createdAt: 'ASC' },
    });
    if (!list) {
      list = await this.shoppingListsRepository.save(
        this.shoppingListsRepository.create({ userId }),
      );
    }

    await this.shoppingListItemsRepository.save(
      this.shoppingListItemsRepository.create({
        listId: list.id,
        articleId,
        autoAdded: true,
      }),
    );
  }
}

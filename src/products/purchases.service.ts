import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  ListItemStatus,
  ShoppingListItem,
} from '../shopping-lists/entities/shopping-list-item.entity';
import { ShoppingList } from '../shopping-lists/entities/shopping-list.entity';
import { RegisterProductPurchaseInput } from './dto/register-product-purchase.input';
import { ConsumptionCycle } from './entities/consumption-cycle.entity';
import { ProductPurchase } from './entities/product-purchase.entity';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

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
    private readonly productsService: ProductsService,
  ) {}

  findPurchases(
    userId: string,
    productId?: string,
  ): Promise<ProductPurchase[]> {
    return this.purchasesRepository.find({
      where: { userId, ...(productId ? { productId } : {}) },
      relations: { product: true },
      order: { purchasedOn: 'DESC', createdAt: 'DESC' },
    });
  }

  findCycles(userId: string, productId: string): Promise<ConsumptionCycle[]> {
    return this.cyclesRepository.find({
      where: { userId, productId },
      relations: { product: true },
      order: { startedOn: 'DESC' },
    });
  }

  hasOpenCycle(productId: string): Promise<boolean> {
    return this.cyclesRepository.exists({
      where: { productId, depletedOn: IsNull() },
    });
  }

  /**
   * Registra una compra. Si el producto es consumible y no tiene ciclo
   * abierto, abre uno nuevo ("hay Shampoo"), y marca como comprados los
   * ítems pendientes de la lista de compras para ese producto.
   */
  async registerPurchase(
    userId: string,
    input: RegisterProductPurchaseInput,
  ): Promise<ProductPurchase> {
    if (!input.productId && !input.newProduct) {
      throw new BadRequestException(
        'Debes enviar productId o newProduct para registrar la compra',
      );
    }
    if (input.productId && input.newProduct) {
      throw new BadRequestException(
        'Envía solo uno: productId o newProduct, no ambos',
      );
    }

    const product = input.productId
      ? await this.productsService.findOne(input.productId, userId)
      : await this.productsService.create(userId, input.newProduct!);

    const purchase = await this.purchasesRepository.save(
      this.purchasesRepository.create({
        userId,
        productId: product.id,
        quantity: input.quantity ?? 1,
        unitPrice: input.unitPrice ?? null,
        store: input.store ?? null,
        purchasedOn: input.purchasedOn,
        expenseId: input.expenseId ?? null,
        notes: input.notes ?? null,
      }),
    );

    // "hay Shampoo": abre ciclo de consumo si es consumible y no hay uno abierto
    if (product.isConsumable && !(await this.hasOpenCycle(product.id))) {
      await this.cyclesRepository.save(
        this.cyclesRepository.create({
          userId,
          productId: product.id,
          purchaseId: purchase.id,
          startedOn: input.purchasedOn,
          quantity: input.quantity ?? 1,
        }),
      );
    }

    // marca como comprados los ítems pendientes de las listas del usuario
    await this.markPendingListItemsPurchased(userId, product.id, purchase.id);

    const saved = await this.purchasesRepository.findOne({
      where: { id: purchase.id },
      relations: { product: true },
    });
    return saved!;
  }

  /**
   * "Se acabó": cierra el ciclo abierto y agrega el producto a la lista
   * de compras (autoAdded) si no está ya pendiente.
   */
  async markDepleted(
    userId: string,
    productId: string,
    depletedOn?: string,
  ): Promise<Product> {
    const product = await this.productsService.findOne(productId, userId);

    const openCycle = await this.cyclesRepository.findOne({
      where: { productId, depletedOn: IsNull() },
    });
    if (!openCycle) {
      throw new BadRequestException(
        'El producto no tiene un ciclo de consumo abierto',
      );
    }

    const depletionDate =
      depletedOn ?? new Date().toISOString().substring(0, 10);
    // el check cycles_date_order exige depleted_on >= started_on
    openCycle.depletedOn =
      depletionDate < openCycle.startedOn ? openCycle.startedOn : depletionDate;
    await this.cyclesRepository.save(openCycle);

    await this.addToShoppingList(userId, productId);
    return product;
  }

  private async markPendingListItemsPurchased(
    userId: string,
    productId: string,
    purchaseId: string,
  ): Promise<void> {
    const pendingItems = await this.shoppingListItemsRepository.find({
      where: {
        productId,
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
    productId: string,
  ): Promise<void> {
    const alreadyPending = await this.shoppingListItemsRepository.exists({
      where: {
        productId,
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
        productId,
        autoAdded: true,
      }),
    );
  }
}

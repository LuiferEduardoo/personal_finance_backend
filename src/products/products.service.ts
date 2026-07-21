import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article } from '../articles/entities/article.entity';
import { CreateProductInput } from './dto/create-product.input';
import { UpdateProductInput } from './dto/update-product.input';
import { ProductStatsView } from './entities/product-stats.view';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductStatsView)
    private readonly productStatsRepository: Repository<ProductStatsView>,
    private readonly articlesService: ArticlesService,
  ) {}

  findAll(
    userId: string,
    search?: string,
    includeInactive = false,
  ): Promise<Product[]> {
    return this.productsRepository.find({
      where: {
        userId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { name: ILike(`%${search}%`) } : {}),
      },
      relations: { category: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id, userId },
      relations: { category: true },
    });
    if (!product) {
      throw new NotFoundException(`Producto ${id} no encontrado`);
    }
    return product;
  }

  async create(userId: string, input: CreateProductInput): Promise<Product> {
    if (input.articleId) {
      await this.articlesService.findOne(input.articleId, userId);
    }
    const product = this.productsRepository.create({ ...input, userId });
    const saved = await this.productsRepository.save(product);
    return this.findOne(saved.id, userId);
  }

  async update(userId: string, input: UpdateProductInput): Promise<Product> {
    const product = await this.findOne(input.id, userId);
    if (input.articleId) {
      await this.articlesService.findOne(input.articleId, userId);
    }
    const { id, ...changes } = input;
    Object.assign(product, changes);
    await this.productsRepository.save(product);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const product = await this.findOne(id, userId);
    await this.productsRepository.remove(product);
    return true;
  }

  productStats(userId: string): Promise<ProductStatsView[]> {
    return this.productStatsRepository.find({
      where: { userId },
      order: { name: 'ASC' },
    });
  }

  // ficha de inventario de un artículo tipo producto: la encuentra o la crea.
  // Así el producto aparece en el query `products` al comprar el artículo.
  async findOrCreateForArticle(
    userId: string,
    article: Article,
  ): Promise<Product> {
    const existing = await this.productsRepository.findOne({
      where: { userId, articleId: article.id },
    });
    if (existing) {
      return existing;
    }
    return this.productsRepository.save(
      this.productsRepository.create({
        userId,
        articleId: article.id,
        name: article.name,
        brand: article.brand,
        categoryId: article.categoryId,
        unit: article.unit ?? undefined,
        isConsumable: true,
      }),
    );
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article, ArticleType } from '../articles/entities/article.entity';
import { UpdateProductInput } from './dto/update-product.input';
import { ProductStatsView } from './entities/product-stats.view';

// "producto" = artículo de tipo PRODUCT (con inventario). Se delega el CRUD en
// ArticlesService; aquí solo se filtra por tipo y se exponen las stats.
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductStatsView)
    private readonly productStatsRepository: Repository<ProductStatsView>,
    private readonly articlesService: ArticlesService,
  ) {}

  findAll(
    userId: string,
    search?: string,
    includeInactive = false,
  ): Promise<Article[]> {
    return this.articlesService.findAll(
      userId,
      search,
      ArticleType.PRODUCT,
      includeInactive,
    );
  }

  findOne(id: string, userId: string): Promise<Article> {
    return this.articlesService.findOne(id, userId);
  }

  update(userId: string, input: UpdateProductInput): Promise<Article> {
    const { id, ...changes } = input;
    return this.articlesService.applyUpdate(userId, id, changes);
  }

  remove(id: string, userId: string): Promise<boolean> {
    return this.articlesService.remove(id, userId);
  }

  productStats(userId: string): Promise<ProductStatsView[]> {
    return this.productStatsRepository.find({
      where: { userId },
      order: { name: 'ASC' },
    });
  }
}

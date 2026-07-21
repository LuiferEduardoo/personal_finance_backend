import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { CreateArticleInput } from './dto/create-article.input';
import { UpdateArticleInput } from './dto/update-article.input';
import { Article, ArticleType } from './entities/article.entity';

@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(Article)
    private readonly articlesRepository: Repository<Article>,
  ) {}

  findAll(
    userId: string,
    search?: string,
    type?: ArticleType,
    includeInactive = false,
  ): Promise<Article[]> {
    return this.articlesRepository.find({
      where: {
        userId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(type ? { type } : {}),
        ...(search ? { name: ILike(`%${search}%`) } : {}),
      },
      relations: { category: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Article> {
    const article = await this.articlesRepository.findOne({
      where: { id, userId },
      relations: { category: true },
    });
    if (!article) {
      throw new NotFoundException(`Artículo ${id} no encontrado`);
    }
    return article;
  }

  async create(userId: string, input: CreateArticleInput): Promise<Article> {
    const article = this.articlesRepository.create({ ...input, userId });
    return this.articlesRepository.save(article);
  }

  async update(userId: string, input: UpdateArticleInput): Promise<Article> {
    const article = await this.findOne(input.id, userId);
    const { id, ...changes } = input;
    Object.assign(article, changes);
    await this.articlesRepository.save(article);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const article = await this.findOne(id, userId);
    await this.articlesRepository.remove(article);
    return true;
  }

  // usado por el flujo de gastos: vincula un artículo existente o crea uno nuevo
  async resolveOrCreate(
    userId: string,
    articleId?: string,
    newArticle?: CreateArticleInput,
  ): Promise<Article> {
    if (articleId && newArticle) {
      throw new BadRequestException(
        'Envía solo uno: articleId o newArticle, no ambos',
      );
    }
    if (articleId) {
      return this.findOne(articleId, userId);
    }
    if (newArticle) {
      return this.create(userId, newArticle);
    }
    throw new BadRequestException('Falta articleId o newArticle');
  }
}

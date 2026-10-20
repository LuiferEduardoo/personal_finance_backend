import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, QueryFailedError, Repository } from 'typeorm';
import { CreateArticleInput } from './dto/create-article.input';
import { UpdateArticleInput } from './dto/update-article.input';
import { Article, ArticleType } from './entities/article.entity';

const UNIQUE_VIOLATION = '23505';

// artículo descrito por una fuente externa (p. ej. la línea de una factura
// electrónica), sin id del catálogo
export interface ExternalArticleInput extends CreateArticleInput {
  type: ArticleType;
  barcode?: string | null;
}

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
    const base = {
      userId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(type ? { type } : {}),
    };
    return this.articlesRepository.find({
      where: search
        ? [
            { ...base, name: ILike(`%${search}%`) },
            { ...base, invoiceName: ILike(`%${search}%`) },
          ]
        : base,
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

  update(userId: string, input: UpdateArticleInput): Promise<Article> {
    const { id, ...changes } = input;
    return this.applyUpdate(userId, id, changes);
  }

  // aplica cambios parciales a un artículo; reutilizado por el CRUD de producto
  async applyUpdate(
    userId: string,
    id: string,
    changes: Partial<Article>,
  ): Promise<Article> {
    const article = await this.findOne(id, userId);
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
      return this.findOrCreateByName(userId, {
        ...newArticle,
        type: newArticle.type ?? ArticleType.PRODUCT,
      });
    }
    throw new BadRequestException('Falta articleId o newArticle');
  }

  // Para importaciones automáticas (facturas del correo): reutiliza el
  // artículo si ya existe y solo lo crea si no. Primero por código de barras,
  // que identifica el producto aunque cambie la descripción; luego por nombre
  // exacto sin distinguir mayúsculas. Sin esto, la segunda factura con el
  // mismo artículo chocaría con articles_name_unique.
  async findOrCreateByName(
    userId: string,
    input: ExternalArticleInput,
  ): Promise<Article> {
    const name = input.name.trim();
    const barcode = input.barcode?.trim() || null;

    const existing = await this.findByBarcodeOrName(
      userId,
      name,
      input.type,
      barcode,
    );
    if (existing) {
      return existing;
    }

    try {
      return await this.articlesRepository.save(
        this.articlesRepository.create({
          ...input,
          userId,
          name,
          type: input.type,
          barcode,
        }),
      );
    } catch (error) {
      // otra ingesta concurrente lo creó entre la búsqueda y el insert
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
      ) {
        const created = await this.findByBarcodeOrName(
          userId,
          name,
          input.type,
          barcode,
        );
        if (created) {
          return created;
        }
      }
      throw error;
    }
  }

  private async findByBarcodeOrName(
    userId: string,
    name: string,
    type: ArticleType,
    barcode: string | null,
  ): Promise<Article | null> {
    if (barcode) {
      const byBarcode = await this.articlesRepository.findOne({
        where: { userId, barcode },
      });
      if (byBarcode) {
        return byBarcode;
      }
    }
    // ILike sin comodines = igualdad sin mayúsculas. El alias de factura se
    // consulta además del nombre canónico para evitar artículos duplicados.
    // Se escapan los comodines que pueda traer el texto impreso.
    return this.articlesRepository.findOne({
      where: [
        { userId, type, name: ILike(escapeLike(name)) },
        { userId, type, invoiceName: ILike(escapeLike(name)) },
      ],
    });
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

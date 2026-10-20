import { QueryFailedError, Repository } from 'typeorm';
import { ArticlesService } from './articles.service';
import { Article, ArticleType } from './entities/article.entity';

function repository(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: Partial<Article>) => value),
    save: jest.fn((value: Partial<Article>) =>
      Promise.resolve({ id: 'new', ...value }),
    ),
    ...overrides,
  };
}

function service(repo: ReturnType<typeof repository>): ArticlesService {
  return new ArticlesService(repo as unknown as Repository<Article>);
}

describe('ArticlesService.findOrCreateByName', () => {
  it('reutiliza el artículo con el mismo código de barras', async () => {
    const repo = repository({
      findOne: jest.fn().mockResolvedValueOnce({ id: 'a1' }),
    });
    const article = await service(repo).findOrCreateByName('u1', {
      name: 'OTRO NOMBRE',
      type: ArticleType.PRODUCT,
      barcode: ' 7700304928064 ',
    });
    expect(article.id).toBe('a1');
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { userId: 'u1', barcode: '7700304928064' },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('sin código de barras busca por nombre y crea si no existe', async () => {
    const repo = repository();
    const article = await service(repo).findOrCreateByName('u1', {
      name: '  MINI CROISSANT  ',
      type: ArticleType.PRODUCT,
    });
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: [
        { userId: 'u1', type: ArticleType.PRODUCT, name: expect.anything() },
        {
          userId: 'u1',
          type: ArticleType.PRODUCT,
          invoiceName: expect.anything(),
        },
      ],
    });
    expect(article).toMatchObject({
      id: 'new',
      name: 'MINI CROISSANT',
      barcode: null,
    });
  });

  it('reutiliza el artículo cuyo alias coincide con la línea de factura', async () => {
    const repo = repository({
      findOne: jest.fn().mockResolvedValueOnce({
        id: 'arroz',
        name: 'Arroz económico',
        invoiceName: 'ARZ ECONOMIC 450g',
      }),
    });

    const article = await service(repo).findOrCreateByName('u1', {
      name: 'ARZ ECONOMIC 450g',
      type: ArticleType.PRODUCT,
    });

    expect(article.id).toBe('arroz');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('si otra ingesta lo crea a la vez, devuelve el que ganó', async () => {
    const violation = new QueryFailedError('insert', [], {
      code: '23505',
    } as unknown as Error);
    const repo = repository({
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'winner' }),
      save: jest.fn().mockRejectedValue(violation),
    });
    const article = await service(repo).findOrCreateByName('u1', {
      name: 'PONQUE',
      type: ArticleType.PRODUCT,
    });
    expect(article.id).toBe('winner');
  });
});

describe('ArticlesService.resolveOrCreate', () => {
  it('resuelve un artículo nuevo por su nombre de factura antes de crearlo', async () => {
    const repo = repository({
      findOne: jest.fn().mockResolvedValueOnce({
        id: 'arroz',
        name: 'Arroz económico',
        invoiceName: 'ARZ ECONOMIC 450g',
      }),
    });

    const article = await service(repo).resolveOrCreate('u1', undefined, {
      name: 'ARZ ECONOMIC 450g',
      type: ArticleType.PRODUCT,
      brand: 'Marca de la factura',
    });

    expect(article.id).toBe('arroz');
    expect(repo.save).not.toHaveBeenCalled();
  });
});

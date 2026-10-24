import { ConfigService } from '@nestjs/config';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/entities/category.entity';
import {
  buildOptions,
  CategoryClassifierService,
  ClassifyInput,
  resolveExpenseCategory,
} from './category-classifier.service';

// el cliente real se sustituye; choice() y noul() siguen siendo los del SDK
jest.mock('@typesafe-ai/sdk', () => ({
  ...jest.requireActual<object>('@typesafe-ai/sdk'),
  TypeSafeClient: jest.fn(),
}));

const category = (
  id: string,
  name: string,
  parentId: string | null = null,
  userId: string | null = null,
) => ({ id, name, parentId, userId }) as Category;

const CATEGORIES = [
  category('alim', 'Alimentación'),
  category('mercado', 'Mercado', 'alim'),
  category('rest', 'Restaurante', 'alim'),
  category('salud', 'Salud'),
  category('transp', 'Transporte'),
];

const LABELS = {
  alim: 'Alimentación',
  mercado: 'Alimentación > Mercado',
  rest: 'Alimentación > Restaurante',
  salud: 'Salud',
  transp: 'Transporte',
};

// respuesta de un choice: probabilidades por id y la confianza que reporta
// la API, (pmax - 1/n) / (1 - 1/n)
function choiceAnswer(
  probabilities: Partial<Record<keyof typeof LABELS, number>>,
) {
  const entries = Object.keys(LABELS).map(
    (id) =>
      [
        LABELS[id as keyof typeof LABELS],
        probabilities[id as keyof typeof LABELS] ?? 0,
      ] as const,
  );
  const [label, pmax] = entries.reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
  const n = entries.length;
  return {
    type: 'choice',
    choice: label,
    confidence: (pmax - 1 / n) / (1 - 1 / n),
    probabilities: Object.fromEntries(entries),
  };
}

function setup(options: {
  apiKey?: string | null;
  categories?: Category[];
  systemOne?: jest.Mock;
}) {
  const systemOne = options.systemOne ?? jest.fn();
  (TypeSafeClient as unknown as jest.Mock).mockImplementation(() => ({
    systemOne,
  }));
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'TYPESAFE_API_KEY'
        ? options.apiKey === undefined
          ? 'ts-key'
          : options.apiKey
        : fallback,
    ),
  };
  const categoriesService = {
    findAll: jest.fn().mockResolvedValue(options.categories ?? CATEGORIES),
  };
  const service = new CategoryClassifierService(
    config as unknown as ConfigService,
    categoriesService as unknown as CategoriesService,
  );
  return { service, systemOne, categoriesService };
}

const INPUT: ClassifyInput = {
  userId: 'u1',
  merchant: 'D1',
  items: [
    { key: 'pan', name: 'PAN TAJADO', quantity: 1, unitPrice: 5000 },
    { key: 'leche', name: 'LECHE ENTERA', quantity: 2, unitPrice: 4500 },
  ],
};

describe('CategoryClassifierService.classify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('acepta la opción más probable con confianza suficiente y hace UNA petición', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        item_0: choiceAnswer({ mercado: 0.95, rest: 0.05 }),
        item_1: choiceAnswer({ mercado: 0.9, salud: 0.1 }),
        purchase: choiceAnswer({ mercado: 0.97, rest: 0.03 }),
      },
    });
    const { service } = setup({ systemOne });

    const result = await service.classify(INPUT);

    expect(systemOne).toHaveBeenCalledTimes(1);
    const [request] = systemOne.mock.calls[0] as [
      {
        state: { merchant: string; items: unknown[] };
        questions: Record<string, { type: string; criteria: object }>;
      },
    ];
    expect(Object.keys(request.questions)).toEqual([
      'item_0',
      'item_1',
      'purchase',
    ]);
    expect(Object.keys(request.questions.purchase.criteria)).toEqual(
      expect.arrayContaining(Object.values(LABELS)),
    );
    expect(request.state.merchant).toBe('D1');
    expect(request.state.items).toHaveLength(2);
    expect(result).toMatchObject({
      classified: true,
      items: { pan: 'mercado', leche: 'mercado' },
      invoiceCategoryId: 'mercado',
      expenseCategoryId: 'mercado',
    });
    expect(result.signals.invoice?.via).toBe('choice');
  });

  it('solo pregunta por los ítems marcados para clasificar', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        item_1: choiceAnswer({ mercado: 1 }),
        purchase: choiceAnswer({ mercado: 1 }),
      },
    });
    const { service } = setup({ systemOne });
    const result = await service.classify({
      ...INPUT,
      items: [{ ...INPUT.items[0], classify: false }, INPUT.items[1]],
    });
    const [request] = systemOne.mock.calls[0] as [
      { questions: object; state: { items: unknown[] } },
    ];
    expect(Object.keys(request.questions)).toEqual(['item_1', 'purchase']);
    // el ítem no preguntado sigue dando contexto a la compra
    expect(request.state.items).toHaveLength(2);
    expect(result.items).toEqual({ leche: 'mercado' });
  });

  it('con baja confianza sube al padre si su rama concentra la probabilidad', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        // 0.45 + 0.4 + 0.05 = 0.9 en la rama Alimentación
        item_0: choiceAnswer({
          mercado: 0.45,
          rest: 0.4,
          alim: 0.05,
          salud: 0.1,
        }),
        item_1: choiceAnswer({ mercado: 0.5, salud: 0.5 }),
        purchase: choiceAnswer({ mercado: 0.5, rest: 0.4, transp: 0.1 }),
      },
    });
    const { service } = setup({ systemOne });
    const result = await service.classify(INPUT);

    expect(result.items).toEqual({ pan: 'alim', leche: null });
    expect(result.signals.items.pan.via).toBe('parent');
    expect(result.invoiceCategoryId).toBe('alim');
  });

  it('sin confianza ni rama dominante no decide', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        item_0: choiceAnswer({ salud: 0.4, transp: 0.35, mercado: 0.25 }),
        item_1: choiceAnswer({ salud: 0.4, transp: 0.35, mercado: 0.25 }),
        purchase: choiceAnswer({ salud: 0.4, transp: 0.35, mercado: 0.25 }),
      },
    });
    const { service } = setup({ systemOne });
    const result = await service.classify(INPUT);
    expect(result).toMatchObject({
      classified: true,
      items: { pan: null, leche: null },
      invoiceCategoryId: null,
      expenseCategoryId: null,
    });
  });

  it('pregunta con un noul si la compra pertenece a la categoría por defecto', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        item_0: choiceAnswer({ salud: 1 }),
        item_1: choiceAnswer({ salud: 1 }),
        purchase: choiceAnswer({ salud: 1 }),
        default_fit: { type: 'noul', noul: 0.1 },
      },
    });
    const { service } = setup({ systemOne });
    const result = await service.classify({
      ...INPUT,
      defaultCategoryId: 'mercado',
    });
    const [request] = systemOne.mock.calls[0] as [
      {
        state: Record<string, unknown>;
        questions: Record<
          string,
          { type: string; instructions?: { default_category?: string } }
        >;
      },
    ];
    // solo la pregunta noul ve la categoría por defecto
    expect(request.state).not.toHaveProperty('default_category');
    expect(request.questions.default_fit.instructions?.default_category).toBe(
      'Alimentación > Mercado',
    );
    expect(request.questions.default_fit.type).toBe('noul');
    expect(result.signals.defaultNoul).toBe(0.1);
    expect(result.expenseCategoryId).toBe('salud');
  });

  it('en la franja dudosa del noul conserva la categoría por defecto', async () => {
    const systemOne = jest.fn().mockResolvedValue({
      answers: {
        item_0: choiceAnswer({ salud: 1 }),
        item_1: choiceAnswer({ salud: 1 }),
        purchase: choiceAnswer({ salud: 1 }),
        default_fit: { type: 'noul', noul: 0.5 },
      },
    });
    const { service } = setup({ systemOne });
    const result = await service.classify({
      ...INPUT,
      defaultCategoryId: 'mercado',
    });
    expect(result.invoiceCategoryId).toBe('salud');
    expect(result.expenseCategoryId).toBe('mercado');
  });

  it('sin TYPESAFE_API_KEY no llama a la API y deja la categoría por defecto', async () => {
    const { service, systemOne, categoriesService } = setup({ apiKey: null });
    const result = await service.classify({
      ...INPUT,
      defaultCategoryId: 'mercado',
    });
    expect(TypeSafeClient).not.toHaveBeenCalled();
    expect(systemOne).not.toHaveBeenCalled();
    expect(categoriesService.findAll).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      classified: false,
      items: {},
      invoiceCategoryId: null,
      expenseCategoryId: 'mercado',
    });
  });

  it('un error de la API no se propaga', async () => {
    const systemOne = jest.fn().mockRejectedValue(new Error('529 overloaded'));
    const { service } = setup({ systemOne });
    await expect(service.classify(INPUT)).resolves.toMatchObject({
      classified: false,
      expenseCategoryId: null,
    });
  });

  it('con más de 255 categorías no clasifica', async () => {
    const many = Array.from({ length: 256 }, (_, i) =>
      category(`c${i}`, `Categoría ${i}`),
    );
    const { service, systemOne } = setup({ categories: many });
    const result = await service.classify(INPUT);
    expect(systemOne).not.toHaveBeenCalled();
    expect(result.classified).toBe(false);
  });

  it('sin categorías de gasto no clasifica', async () => {
    const { service, systemOne } = setup({ categories: [] });
    const result = await service.classify(INPUT);
    expect(systemOne).not.toHaveBeenCalled();
    expect(result.classified).toBe(false);
  });
});

describe('buildOptions', () => {
  it('incluye la jerarquía y numera las etiquetas repetidas', () => {
    const options = buildOptions([
      category('a', 'Alimentación'),
      category('m1', 'Mercado', 'a'),
      category('m2', 'Mercado', 'a', 'u1'),
      category('x', 'Mercado'),
    ]);
    expect(options.map((o) => [o.id, o.label])).toEqual([
      ['a', 'Alimentación'],
      ['m1', 'Alimentación > Mercado'],
      ['m2', 'Alimentación > Mercado (2)'],
      ['x', 'Mercado'],
    ]);
    expect(new Set(options.map((o) => o.label)).size).toBe(4);
  });
});

describe('resolveExpenseCategory', () => {
  it('sin categoría por defecto usa la de Jev o null', () => {
    expect(resolveExpenseCategory(null, 'jev', null)).toBe('jev');
    expect(resolveExpenseCategory(null, null, null)).toBeNull();
  });

  it('Jev solo reemplaza la por defecto si la descarta con claridad', () => {
    expect(resolveExpenseCategory('def', 'jev', 0.1)).toBe('jev');
    // franja dudosa y "sí pertenece"
    expect(resolveExpenseCategory('def', 'jev', 0.3)).toBe('def');
    expect(resolveExpenseCategory('def', 'jev', 0.9)).toBe('def');
  });

  it('conserva la por defecto si el choice no se aceptó o coincide', () => {
    expect(resolveExpenseCategory('def', null, 0.05)).toBe('def');
    expect(resolveExpenseCategory('def', 'def', 0.05)).toBe('def');
    // sin noul (p. ej. la por defecto ya no está activa)
    expect(resolveExpenseCategory('def', 'jev', null)).toBe('def');
  });
});

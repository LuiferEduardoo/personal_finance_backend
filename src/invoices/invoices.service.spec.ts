import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  CategoryClassifierService,
  ClassificationResult,
} from '../categorization/category-classifier.service';
import { InvoiceAnalysis } from './entities/invoice-analysis.entity';
import { InvoicesService } from './invoices.service';

const EXTRACTED = {
  description: 'Compra en D1',
  merchant: 'D1',
  occurredOn: '2026-10-20',
  currency: 'COP',
  amount: null,
  total: 12000,
  categorySuggestion: 'Supermercado',
  items: [
    {
      newArticle: { name: 'PAN', type: 'product', unit: 'unit', brand: null },
      unitPrice: 3500,
      quantity: 2,
      lineTotal: 7000,
      discount: null,
      description: null,
    },
    {
      newArticle: { name: 'LECHE', type: 'product', unit: 'unit', brand: null },
      unitPrice: 4500,
      quantity: 1,
      lineTotal: 4500,
      discount: null,
      description: null,
    },
  ],
};

function setup(classification: Partial<ClassificationResult>) {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(EXTRACTED) } }],
  });
  const classifier = {
    classify: jest.fn().mockResolvedValue({
      classified: true,
      items: {},
      invoiceCategoryId: null,
      expenseCategoryId: null,
      signals: { items: {}, invoice: null, defaultNoul: null },
      ...classification,
    }),
  };
  const repository = {
    create: jest.fn((value: object) => value),
    save: jest.fn().mockResolvedValue({}),
  };
  const service = new InvoicesService(
    { get: (_: string, fallback?: string) => fallback } as ConfigService,
    repository as unknown as Repository<InvoiceAnalysis>,
    classifier as unknown as CategoryClassifierService,
  );
  // cliente de OpenAI simulado (el real se crea perezosamente)
  (service as unknown as { client: object }).client = {
    chat: { completions: { create } },
  };
  return { service, create, classifier, repository };
}

describe('InvoicesService', () => {
  it('pide la imagen en alta resolución y con temperatura 0', async () => {
    const ctx = setup({});
    await ctx.service.analyzeImage('u1', Buffer.from('img'), 'image/png');
    const [request] = ctx.create.mock.calls[0] as [
      {
        temperature: number;
        messages: { content: { type: string; image_url?: object }[] }[];
      },
    ];
    expect(request.temperature).toBe(0);
    expect(request.messages[1].content[1].image_url).toMatchObject({
      detail: 'high',
    });
  });

  it('añade las categorías sugeridas y avisa si el total no cuadra', async () => {
    const ctx = setup({
      items: { '0': 'cat-panaderia', '1': null },
      invoiceCategoryId: 'cat-mercado',
      expenseCategoryId: 'cat-mercado',
    });
    const draft = await ctx.service.analyzeText('u1', 'factura');

    expect(ctx.classifier.classify).toHaveBeenCalledWith({
      userId: 'u1',
      merchant: 'D1',
      items: [
        expect.objectContaining({ key: '0', name: 'PAN', lineTotal: 7000 }),
        expect.objectContaining({ key: '1', name: 'LECHE' }),
      ],
    });
    expect(draft.categoryId).toBe('cat-mercado');
    expect(draft.categorySuggestion).toBe('Supermercado');
    expect(draft.items.map((i) => i.newArticle.categoryId)).toEqual([
      'cat-panaderia',
      null,
    ]);
    // 7.000 + 4.500 = 11.500 frente a un total de 12.000
    expect(draft.warnings).toEqual([
      expect.stringContaining('La suma de las líneas'),
    ]);
    expect(draft.amount).toBeNull();
    // el histórico guarda el borrador ya clasificado
    expect(ctx.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ categoryId: 'cat-mercado' }),
      }),
    );
  });

  it('sin clasificación el borrador sale sin categorías', async () => {
    const ctx = setup({ classified: false });
    const draft = await ctx.service.analyzeText('u1', 'factura');
    expect(draft.categoryId).toBeNull();
    expect(draft.items.every((i) => i.newArticle.categoryId === null)).toBe(
      true,
    );
  });
});

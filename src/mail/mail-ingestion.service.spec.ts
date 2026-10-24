import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { CategorizationQueue } from '../categorization/categorization-queue';
import {
  CategoryClassifierService,
  ClassificationResult,
  ClassifyInput,
} from '../categorization/category-classifier.service';
import { ExpensesService } from '../transactions/expenses.service';
import { MailConnection } from './entities/mail-connection.entity';
import { MailInvoice } from './entities/mail-invoice.entity';
import { MailMessage, MailMessageStatus } from './entities/mail-message.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailApi, GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { MailIngestionService } from './mail-ingestion.service';
import { ParsedInvoice } from './parsing/ubl-invoice.parser';

const D1_XML = readFileSync(
  join(__dirname, 'parsing', '__fixtures__', 'd1-attached-document.xml'),
);

const connection = { id: 'conn-1', userId: 'user-1' } as MailConnection;
const api = {} as GmailApi;
const sender = {
  id: 'sender-1',
  emailAddress: 'facturacionelectronica@d1.com.co',
  merchantName: 'D1',
  defaultAccountId: 'account-1',
  defaultCategoryId: null,
} as MailSender;
const senders = new Map([[sender.emailAddress, sender]]);

// insert().orIgnore().returning().execute() de TypeORM: raw vacío = conflicto
function insertBuilder(results: { id: string }[][]) {
  const execute = jest.fn();
  for (const raw of results) {
    execute.mockResolvedValueOnce({ raw });
  }
  const builder = {
    insert: () => builder,
    into: () => builder,
    values: jest.fn(() => builder),
    orIgnore: () => builder,
    returning: () => builder,
    execute,
  };
  return builder;
}

function setup(options: {
  from?: string;
  messageClaimed?: boolean;
  invoiceReserved?: boolean;
  attachments?: { filename: string; mimeType: string; data: Buffer }[];
  createExpense?: jest.Mock;
  classify?: jest.Mock;
  articleCategories?: (string | null)[];
}) {
  const messages = insertBuilder([
    options.messageClaimed === false ? [] : [{ id: 'msg-row-1' }],
  ]);
  const invoices = insertBuilder([
    options.invoiceReserved === false ? [] : [{ id: 'inv-row-1' }],
  ]);
  const messagesRepository = {
    createQueryBuilder: () => messages,
    findOneByOrFail: jest.fn().mockResolvedValue({
      id: 'msg-row-1',
      userId: 'user-1',
      gmailMessageId: 'gmail-1',
    }),
    update: jest.fn(),
  };
  const invoicesRepository = {
    createQueryBuilder: () => invoices,
    update: jest.fn(),
    delete: jest.fn(),
  };
  const gmailClient = {
    getMeta: jest.fn().mockResolvedValue({
      id: 'gmail-1',
      from: options.from ?? sender.emailAddress,
      subject: 'Factura',
      receivedAt: new Date('2026-09-22T22:30:00Z'),
    }),
    getInvoiceAttachments: jest
      .fn()
      .mockResolvedValue(
        options.attachments ?? [
          { filename: 'factura.xml', mimeType: 'text/xml', data: D1_XML },
        ],
      ),
  };
  let articleCounter = 0;
  const articlesService = {
    findOrCreateByName: jest.fn(() => {
      const index = articleCounter++;
      return Promise.resolve({
        id: `article-${index + 1}`,
        categoryId: options.articleCategories?.[index] ?? null,
      });
    }),
    assignCategoryIfMissing: jest.fn().mockResolvedValue(true),
  };
  // sin clave de TypeSafe: no clasifica y deja la categoría por defecto
  const classifier = {
    classify:
      options.classify ??
      jest.fn((input: ClassifyInput) =>
        Promise.resolve(unclassified(input.defaultCategoryId ?? null)),
      ),
  };
  const expensesService = {
    create:
      options.createExpense ??
      jest.fn().mockResolvedValue({ id: 'expense-1', categoryId: null }),
    updateCategoryIfUnchanged: jest.fn().mockResolvedValue(true),
  };
  // la cola real: los tests esperan a que termine con queue.idle()
  const queue = new CategorizationQueue();

  const service = new MailIngestionService(
    messagesRepository as unknown as Repository<MailMessage>,
    invoicesRepository as unknown as Repository<MailInvoice>,
    {} as Repository<MailSender>,
    gmailClient as unknown as GmailClientService,
    {} as MailConnectionsService,
    articlesService as unknown as ArticlesService,
    expensesService as unknown as ExpensesService,
    classifier as unknown as CategoryClassifierService,
    queue,
  );
  return {
    classifier,
    queue,
    service,
    messagesRepository,
    invoicesRepository,
    gmailClient,
    articlesService,
    expensesService,
  };
}

function unclassified(expenseCategoryId: string | null): ClassificationResult {
  return {
    classified: false,
    items: {},
    invoiceCategoryId: null,
    expenseCategoryId,
    signals: { items: {}, invoice: null, defaultNoul: null },
  };
}

function classified(
  partial: Partial<ClassificationResult>,
): ClassificationResult {
  return {
    ...unclassified(null),
    classified: true,
    ...partial,
  };
}

const lastStatus = (repo: { update: jest.Mock }) =>
  (repo.update.mock.calls.at(-1) as [unknown, { status: string }])[1];

describe('MailIngestionService.ingest', () => {
  it('registra el gasto con ítems en la cuenta por defecto del remitente', async () => {
    const ctx = setup({});
    const status = await ctx.service.ingest(
      connection,
      api,
      'gmail-1',
      senders,
    );

    expect(status).toBe(MailMessageStatus.REGISTERED);
    expect(ctx.articlesService.findOrCreateByName).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        name: 'MINI CROISSANT HORNE',
        type: 'product',
        barcode: '7700304928064',
      },
    );
    expect(ctx.expensesService.create).toHaveBeenCalledWith('user-1', {
      description: 'D1 · factura M2J675929',
      occurredOn: '2026-09-22',
      currency: 'COP',
      merchant: 'D1',
      accountId: 'account-1',
      categoryId: undefined,
      notes: expect.stringContaining('68028e3a') as string,
      items: [
        {
          articleId: 'article-1',
          unitPrice: 3990,
          quantity: 1,
          discount: undefined,
        },
        {
          articleId: 'article-2',
          unitPrice: 3990,
          quantity: 1,
          discount: undefined,
        },
      ],
    });
    expect(ctx.invoicesRepository.update).toHaveBeenCalledWith(
      { id: 'inv-row-1' },
      { expenseId: 'expense-1' },
    );
    expect(lastStatus(ctx.messagesRepository)).toEqual({
      status: MailMessageStatus.REGISTERED,
      error: null,
      expenseId: 'expense-1',
    });
  });

  it('un remitente no configurado no deja rastro ni descarga adjuntos', async () => {
    const ctx = setup({ from: 'promos@tienda.co' });
    expect(
      await ctx.service.ingest(connection, api, 'gmail-1', senders),
    ).toBeNull();
    expect(ctx.gmailClient.getInvoiceAttachments).not.toHaveBeenCalled();
    expect(ctx.messagesRepository.update).not.toHaveBeenCalled();
  });

  it('un correo que ya procesó otra vía no se vuelve a procesar', async () => {
    const ctx = setup({ messageClaimed: false });
    expect(
      await ctx.service.ingest(connection, api, 'gmail-1', senders),
    ).toBeNull();
    expect(ctx.gmailClient.getInvoiceAttachments).not.toHaveBeenCalled();
  });

  it('la misma factura (mismo CUFE) en otro correo queda como duplicada', async () => {
    const ctx = setup({ invoiceReserved: false });
    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.DUPLICATE,
    );
    expect(ctx.expensesService.create).not.toHaveBeenCalled();
  });

  it('sin XML de factura queda como no_invoice', async () => {
    const ctx = setup({
      attachments: [
        {
          filename: 'f.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('%PDF'),
        },
      ],
    });
    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.NO_INVOICE,
    );
  });

  it('si el gasto falla (sin cupo) libera la factura y guarda el motivo', async () => {
    const ctx = setup({
      createExpense: jest
        .fn()
        .mockRejectedValue(new BadRequestException('Cupo insuficiente')),
    });
    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.FAILED,
    );
    expect(ctx.invoicesRepository.delete).toHaveBeenCalledWith({
      id: 'inv-row-1',
    });
    expect(lastStatus(ctx.messagesRepository)).toMatchObject({
      status: MailMessageStatus.FAILED,
      error: 'Cupo insuficiente',
    });
  });
});

describe('MailIngestionService: clasificación en segundo plano', () => {
  it('registra el gasto sin esperar a Jev y clasifica después', async () => {
    // una clasificación que nunca termina no bloquea el registro
    const classify = jest.fn(() => new Promise<ClassificationResult>(() => {}));
    const ctx = setup({ classify });

    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.REGISTERED,
    );
    expect(ctx.expensesService.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ categoryId: undefined }),
    );
    expect(lastStatus(ctx.messagesRepository)).toMatchObject({
      status: MailMessageStatus.REGISTERED,
    });
    // se encola solo después de marcar el correo como registrado
    expect(classify).toHaveBeenCalledTimes(1);
    expect(
      ctx.messagesRepository.update.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(classify.mock.invocationCallOrder[0]);
    expect(ctx.expensesService.create.mock.invocationCallOrder[0]).toBeLessThan(
      classify.mock.invocationCallOrder[0],
    );
    expect(
      ctx.expensesService.updateCategoryIfUnchanged,
    ).not.toHaveBeenCalled();
  });

  it('solo pregunta por los artículos sin categoría y guarda las sugerencias sin pisar', async () => {
    const classify = jest.fn().mockResolvedValue(
      classified({
        items: { 'article-2': 'cat-panaderia' },
        invoiceCategoryId: 'cat-mercado',
        expenseCategoryId: 'cat-mercado',
      }),
    );
    const ctx = setup({ classify, articleCategories: ['cat-usuario', null] });
    await ctx.service.ingest(connection, api, 'gmail-1', senders);
    await ctx.queue.idle();

    const input = classify.mock.calls[0][0] as ClassifyInput;
    expect(input).toMatchObject({
      userId: 'user-1',
      defaultCategoryId: null,
    });
    expect(input.items.map((i) => [i.key, i.classify])).toEqual([
      ['article-1', false],
      ['article-2', true],
    ]);
    expect(input.items[0]).toMatchObject({
      name: 'MINI CROISSANT HORNE',
      quantity: 1,
      unitPrice: 3990,
      lineTotal: 3990,
    });
    expect(ctx.articlesService.assignCategoryIfMissing).toHaveBeenCalledTimes(
      1,
    );
    expect(ctx.articlesService.assignCategoryIfMissing).toHaveBeenCalledWith(
      'user-1',
      'article-2',
      'cat-panaderia',
    );
    // el gasto se registró sin categoría y la tarea la pone si sigue así
    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'expense-1',
      null,
      'cat-mercado',
    );
  });

  it('registra con la categoría por defecto y Jev solo la cambia si sigue igual', async () => {
    const withDefault = { ...sender, defaultCategoryId: 'cat-default' };
    const classify = jest.fn().mockResolvedValue(
      classified({
        invoiceCategoryId: 'cat-farmacia',
        expenseCategoryId: 'cat-farmacia',
      }),
    );
    const ctx = setup({
      classify,
      createExpense: jest
        .fn()
        .mockResolvedValue({ id: 'expense-1', categoryId: 'cat-default' }),
    });
    await ctx.service.ingest(
      connection,
      api,
      'gmail-1',
      new Map([[withDefault.emailAddress, withDefault]]),
    );
    expect(ctx.expensesService.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ categoryId: 'cat-default' }),
    );
    await ctx.queue.idle();
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCategoryId: 'cat-default' }),
    );
    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'expense-1',
      'cat-default',
      'cat-farmacia',
    );
  });

  it('si el usuario cambió la categoría entretanto, no se pisa', async () => {
    const classify = jest
      .fn()
      .mockResolvedValue(classified({ expenseCategoryId: 'cat-mercado' }));
    const ctx = setup({ classify });
    // el UPDATE condicional no afecta filas: la categoría ya no es la inicial
    ctx.expensesService.updateCategoryIfUnchanged.mockResolvedValue(false);
    await ctx.service.ingest(connection, api, 'gmail-1', senders);
    await ctx.queue.idle();

    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledTimes(
      1,
    );
    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'expense-1',
      null,
      'cat-mercado',
    );
    expect(ctx.queue.pending).toBe(0);
  });

  it('respeta la categoría heredada del único artículo si el remitente no tiene por defecto', async () => {
    const classify = jest
      .fn()
      .mockResolvedValue(classified({ expenseCategoryId: 'cat-mercado' }));
    const ctx = setup({
      classify,
      createExpense: jest
        .fn()
        .mockResolvedValue({ id: 'expense-1', categoryId: 'cat-articulo' }),
    });
    await ctx.service.ingest(connection, api, 'gmail-1', senders);
    await ctx.queue.idle();
    expect(classify).toHaveBeenCalled();
    expect(
      ctx.expensesService.updateCategoryIfUnchanged,
    ).not.toHaveBeenCalled();
  });

  it('sin clasificación no toca artículos ni el gasto', async () => {
    const withDefault = { ...sender, defaultCategoryId: 'cat-default' };
    const ctx = setup({
      createExpense: jest
        .fn()
        .mockResolvedValue({ id: 'expense-1', categoryId: 'cat-default' }),
    });
    await ctx.service.ingest(
      connection,
      api,
      'gmail-1',
      new Map([[withDefault.emailAddress, withDefault]]),
    );
    await ctx.queue.idle();
    expect(ctx.articlesService.assignCategoryIfMissing).not.toHaveBeenCalled();
    expect(
      ctx.expensesService.updateCategoryIfUnchanged,
    ).not.toHaveBeenCalled();
  });

  it('un fallo del clasificador deja el gasto intacto', async () => {
    const classify = jest.fn().mockRejectedValue(new Error('TypeSafe caído'));
    const ctx = setup({ classify });
    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.REGISTERED,
    );
    await ctx.queue.idle();

    expect(classify).toHaveBeenCalledTimes(1);
    expect(ctx.invoicesRepository.delete).not.toHaveBeenCalled();
    expect(
      ctx.expensesService.updateCategoryIfUnchanged,
    ).not.toHaveBeenCalled();
    expect(lastStatus(ctx.messagesRepository)).toMatchObject({
      status: MailMessageStatus.REGISTERED,
      expenseId: 'expense-1',
    });
  });

  it('si guardar la sugerencia de un artículo falla, sigue con el gasto', async () => {
    const classify = jest.fn().mockResolvedValue(
      classified({
        items: { 'article-1': 'cat-x' },
        expenseCategoryId: 'cat-x',
      }),
    );
    const ctx = setup({ classify });
    ctx.articlesService.assignCategoryIfMissing.mockRejectedValue(
      new Error('db caída'),
    );
    expect(await ctx.service.ingest(connection, api, 'gmail-1', senders)).toBe(
      MailMessageStatus.REGISTERED,
    );
    await ctx.queue.idle();
    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'expense-1',
      null,
      'cat-x',
    );
  });

  it('una factura sin líneas se registra por el importe y se clasifica por el comercio y el emisor', async () => {
    const classify = jest.fn().mockResolvedValue(
      classified({
        invoiceCategoryId: 'cat-servicios',
        expenseCategoryId: 'cat-servicios',
      }),
    );
    const ctx = setup({ classify });
    const invoice: ParsedInvoice = {
      cufe: 'cufe-1',
      number: 'F-1',
      issueDate: '2026-09-22',
      currency: 'COP',
      issuerName: 'KOBA COLOMBIA S.A.S.',
      issuerNit: null,
      total: 50000,
      items: [],
    };
    const internals = ctx.service as unknown as {
      registerExpense: (
        userId: string,
        sender: MailSender,
        invoice: ParsedInvoice,
      ) => Promise<{ expense: { id: string }; lines: unknown[] }>;
      categorize: (job: object) => Promise<void>;
    };
    const { expense, lines } = await internals.registerExpense(
      'user-1',
      sender,
      invoice,
    );
    expect(classify).not.toHaveBeenCalled();
    expect(ctx.expensesService.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ amount: 50000, categoryId: undefined }),
    );

    await internals.categorize({
      userId: 'user-1',
      sender,
      invoice,
      lines,
      expenseId: expense.id,
      initialCategoryId: null,
    });
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: 'D1 (KOBA COLOMBIA S.A.S.)',
        items: [],
      }),
    );
    expect(ctx.expensesService.updateCategoryIfUnchanged).toHaveBeenCalledWith(
      'user-1',
      'expense-1',
      null,
      'cat-servicios',
    );
  });
});

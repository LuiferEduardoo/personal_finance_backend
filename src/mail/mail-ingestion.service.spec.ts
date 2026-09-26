import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { ExpensesService } from '../transactions/expenses.service';
import { MailConnection } from './entities/mail-connection.entity';
import { MailInvoice } from './entities/mail-invoice.entity';
import { MailMessage, MailMessageStatus } from './entities/mail-message.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailApi, GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { MailIngestionService } from './mail-ingestion.service';

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
    findOrCreateByName: jest.fn(() =>
      Promise.resolve({ id: `article-${++articleCounter}` }),
    ),
  };
  const expensesService = {
    create:
      options.createExpense ?? jest.fn().mockResolvedValue({ id: 'expense-1' }),
  };

  const service = new MailIngestionService(
    messagesRepository as unknown as Repository<MailMessage>,
    invoicesRepository as unknown as Repository<MailInvoice>,
    {} as Repository<MailSender>,
    gmailClient as unknown as GmailClientService,
    {} as MailConnectionsService,
    articlesService as unknown as ArticlesService,
    expensesService as unknown as ExpensesService,
  );
  return {
    service,
    messagesRepository,
    invoicesRepository,
    gmailClient,
    articlesService,
    expensesService,
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

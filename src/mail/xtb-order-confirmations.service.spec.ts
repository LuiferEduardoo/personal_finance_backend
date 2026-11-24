import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { CategorizationQueue } from '../categorization/categorization-queue';
import { CategoryClassifierService } from '../categorization/category-classifier.service';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import {
  PdfPasswordException,
  PdfStatementService,
} from '../investments/import/pdf-statement.service';
import { InvestmentAccountsService } from '../investments/investment-accounts.service';
import { InvestmentTransactionsService } from '../investments/investment-transactions.service';
import { InstrumentsService } from '../market-data/instruments.service';
import { ExpensesService } from '../transactions/expenses.service';
import { MailConnection } from './entities/mail-connection.entity';
import { MailInvoice } from './entities/mail-invoice.entity';
import { MailMessage, MailMessageStatus } from './entities/mail-message.entity';
import { MailSender, MailSenderKind } from './entities/mail-sender.entity';
import { GmailApi, GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailIngestionService } from './mail-ingestion.service';
import { MailSendersService } from './mail-senders.service';
import { XtbOrderConfirmationsService } from './xtb-order-confirmations.service';

// Datos inventados. La ingesta y el servicio de XTB son los reales; solo se
// falsea lo que habla con Gmail, el PDF y la base.
const PASSWORD = 'contraseña-secreta-de-prueba';
const connection = { id: 'conn-1', userId: 'user-1' } as MailConnection;
const api = {} as GmailApi;
const sender = {
  id: 'sender-1',
  kind: MailSenderKind.XTB_ORDER_CONFIRMATION,
  emailAddress: 'confirmaciones@xtb.test',
  investmentAccountId: 'inv-account-1',
} as MailSender;

const row = (index: number, id: string, ticker: string, volume = '0,0810') =>
  `${index} ${id} ${ticker} Nombre del activo
XTB ${volume} 27/5/2026
9:00:45
market 809,27000 ${volume === '0,0810' ? '65,55087' : '809,27000'} ETFs USD 1.0000 0,00 0,00 0,00`;

const TWO_BUYS_AND_A_SELL = `Órdenes de compra de Acciones Fraccionadas ejecutadas (2)
${row(1, '9000000001', 'CSPX.UK')}
${row(2, '9000000002', 'NVDA.US', '1,0000')}
Órdenes de venta de Acciones Fraccionadas ejecutadas (1)
${row(1, '9000000003', 'CSPX.UK')}
`;

function insertBuilder() {
  const builder = {
    insert: () => builder,
    into: () => builder,
    values: () => builder,
    orIgnore: () => builder,
    returning: () => builder,
    execute: jest.fn().mockResolvedValue({ raw: [{ id: 'msg-1' }] }),
  };
  return builder;
}

function setup(
  options: {
    text?: string;
    extractText?: jest.Mock;
    createBatch?: jest.Mock;
    sender?: MailSender;
    password?: string | null;
    attachments?: { filename: string; mimeType: string; data: Buffer }[];
    accountCurrency?: string;
    instrumentCurrency?: string;
  } = {},
) {
  const messageRow = {
    id: 'msg-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    senderId: sender.id,
    gmailMessageId: 'gmail-1',
    status: MailMessageStatus.FAILED,
  };
  const messagesRepository = {
    createQueryBuilder: () => insertBuilder(),
    findOneByOrFail: jest.fn().mockResolvedValue(messageRow),
    findOne: jest.fn().mockResolvedValue(messageRow),
    update: jest.fn(),
  };
  const gmailClient = {
    getMeta: jest.fn().mockResolvedValue({
      id: 'gmail-1',
      from: sender.emailAddress,
      subject: 'Confirmación',
      receivedAt: new Date('2026-05-27T22:00:00Z'),
    }),
    getInvoiceAttachments: jest.fn(),
    getPdfAttachments: jest.fn().mockResolvedValue(
      options.attachments ?? [
        {
          filename: 'confirmacion.pdf',
          mimeType: 'application/octet-stream',
          data: Buffer.from('pdf'),
        },
      ],
    ),
  };
  const pdfService = {
    extractText:
      options.extractText ??
      jest.fn().mockResolvedValue({
        text: options.text ?? TWO_BUYS_AND_A_SELL,
        pages: 1,
      }),
  };
  const sendersService = {
    attachmentPasswordOf: jest
      .fn()
      .mockReturnValue(
        options.password === undefined ? PASSWORD : options.password,
      ),
  };
  const accountsService = {
    findOne: jest.fn().mockResolvedValue({
      id: 'inv-account-1',
      currency: options.accountCurrency ?? 'USD',
    }),
  };
  const transactionsService = {
    createBatch:
      options.createBatch ??
      jest.fn().mockResolvedValue({ inserted: 3, duplicates: 0 }),
  };
  const instrumentsService = {
    findByBrokerSymbol: jest.fn((ticker: string) =>
      Promise.resolve(
        ticker === 'CSPX.UK'
          ? {
              id: 'inst-cspx',
              symbol: 'CSPX',
              currency: options.instrumentCurrency ?? 'USD',
            }
          : null,
      ),
    ),
    resolveOrCreate: jest.fn((ticker: string) =>
      Promise.resolve({
        id: `inst-${ticker}`,
        symbol: ticker,
        currency: 'USD',
      }),
    ),
  };
  const queue = { enqueue: jest.fn() };
  const invoicesRepository = { delete: jest.fn() };
  const sendersRepository = {
    findOne: jest.fn().mockResolvedValue(options.sender ?? sender),
  };
  const connectionsService = {
    findOne: jest.fn().mockResolvedValue(connection),
    gmailFor: jest.fn(() => api),
  };

  const xtb = new XtbOrderConfirmationsService(
    gmailClient as unknown as GmailClientService,
    sendersService as unknown as MailSendersService,
    pdfService as unknown as PdfStatementService,
    accountsService as unknown as InvestmentAccountsService,
    transactionsService as unknown as InvestmentTransactionsService,
    instrumentsService as unknown as InstrumentsService,
  );
  const notifications = { notify: jest.fn().mockResolvedValue(true) };
  const ingestion = new MailIngestionService(
    messagesRepository as unknown as Repository<MailMessage>,
    invoicesRepository as unknown as Repository<MailInvoice>,
    sendersRepository as unknown as Repository<MailSender>,
    gmailClient as unknown as GmailClientService,
    connectionsService as unknown as MailConnectionsService,
    {} as ArticlesService,
    {} as ExpensesService,
    {} as CategoryClassifierService,
    queue as unknown as CategorizationQueue,
    xtb,
    notifications as unknown as NotificationsService,
  );
  const ingest = (target = options.sender ?? sender) =>
    ingestion.ingest(
      connection,
      api,
      'gmail-1',
      new Map([[target.emailAddress, target]]),
    );
  return {
    ingest,
    ingestion,
    messagesRepository,
    gmailClient,
    pdfService,
    transactionsService,
    instrumentsService,
    queue,
    notifications,
  };
}

const finalUpdate = (ctx: { messagesRepository: { update: jest.Mock } }) =>
  (
    ctx.messagesRepository.update.mock.calls.at(-1) as [
      unknown,
      {
        status: MailMessageStatus;
        error: string | null;
        expenseId: string | null;
        operationsRecorded: number | null;
      },
    ]
  )[1];

describe('Ingesta de confirmaciones de órdenes de XTB', () => {
  it('registra las órdenes en una sola escritura y deja la cuenta en la bitácora', async () => {
    const ctx = setup();

    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.REGISTERED);

    expect(ctx.pdfService.extractText).toHaveBeenCalledWith(
      Buffer.from('pdf'),
      PASSWORD,
    );
    // todo el documento va en UNA llamada, que es la transacción
    expect(ctx.transactionsService.createBatch).toHaveBeenCalledTimes(1);
    const [userId, accountId, inputs] = ctx.transactionsService.createBatch.mock
      .calls[0] as [string, string, Record<string, unknown>[]];
    expect([userId, accountId]).toEqual(['user-1', 'inv-account-1']);
    expect(inputs.map((input) => input.type)).toEqual([
      InvestmentTransactionType.BUY,
      InvestmentTransactionType.BUY,
      InvestmentTransactionType.SELL,
    ]);
    expect(inputs[0]).toMatchObject({
      instrumentId: 'inst-cspx',
      occurredOn: '2026-05-27',
      occurredAt: new Date('2026-05-27T09:00:45Z'),
      quantity: 0.081,
      price: 809.27,
      amount: 65.55087,
      fee: 0,
      currency: 'USD',
      occurrenceIndex: 0,
      externalId: '9000000001',
    });
    expect(finalUpdate(ctx)).toEqual({
      status: MailMessageStatus.REGISTERED,
      error: null,
      expenseId: null,
      operationsRecorded: 3,
    });
    expect(ctx.queue.enqueue).not.toHaveBeenCalled();
    expect(ctx.gmailClient.getInvoiceAttachments).not.toHaveBeenCalled();
  });

  it('un ticker nuevo se crea como en la sincronización y sin sufijo para Twelve Data', async () => {
    const ctx = setup();
    await ctx.ingest();
    expect(ctx.instrumentsService.resolveOrCreate).toHaveBeenCalledWith(
      'NVDA.US',
      expect.objectContaining({
        currency: 'USD',
        name: 'Nombre del activo',
        twelveDataSymbol: 'NVDA',
      }),
    );
  });

  it('dos órdenes idénticas del documento se distinguen por occurrenceIndex', async () => {
    const ctx = setup({
      text: `Órdenes de compra de Acciones Fraccionadas ejecutadas (3)
${row(1, '9000000001', 'CSPX.UK')}
${row(2, '9000000002', 'CSPX.UK')}
${row(3, '9000000003', 'CSPX.UK')}
`,
    });
    await ctx.ingest();
    const inputs = ctx.transactionsService.createBatch.mock.calls[0][2] as {
      occurrenceIndex: number;
    }[];
    expect(inputs.map((input) => input.occurrenceIndex)).toEqual([0, 1, 2]);
  });

  it('una contraseña incorrecta queda FAILED sin filtrarla ni escribir nada', async () => {
    const ctx = setup({
      extractText: jest
        .fn()
        .mockRejectedValue(
          new PdfPasswordException(
            'La contraseña configurada no abre el PDF: es incorrecta',
          ),
        ),
    });

    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);

    const { error } = finalUpdate(ctx);
    expect(error).toContain('contraseña configurada');
    expect(
      JSON.stringify(ctx.messagesRepository.update.mock.calls),
    ).not.toContain(PASSWORD);
    // también avisa en la app, sin la contraseña
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ link: '/settings/mail' }),
    );
    expect(JSON.stringify(ctx.notifications.notify.mock.calls)).not.toContain(
      PASSWORD,
    );
    expect(ctx.transactionsService.createBatch).not.toHaveBeenCalled();
  });

  it('sin cuenta de inversión queda FAILED sin bajar el correo', async () => {
    const ctx = setup({
      sender: { ...sender, investmentAccountId: null } as MailSender,
    });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    expect(finalUpdate(ctx).error).toContain('cuenta de inversión');
    expect(ctx.gmailClient.getPdfAttachments).not.toHaveBeenCalled();
  });

  it('sin contraseña queda FAILED sin bajar el correo', async () => {
    const ctx = setup({ password: null });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    expect(finalUpdate(ctx).error).toContain('contraseña de PDF');
    expect(ctx.gmailClient.getPdfAttachments).not.toHaveBeenCalled();
  });

  it('si todas las órdenes ya estaban, el correo es DUPLICATE', async () => {
    const ctx = setup({
      createBatch: jest.fn().mockResolvedValue({ inserted: 0, duplicates: 3 }),
    });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.DUPLICATE);
    expect(finalUpdate(ctx)).toMatchObject({
      error: 'Las 3 operaciones del correo ya estaban registradas',
      operationsRecorded: 0,
    });
  });

  it('si solo algunas estaban, cuenta las que entraron', async () => {
    const ctx = setup({
      createBatch: jest.fn().mockResolvedValue({ inserted: 1, duplicates: 2 }),
    });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.REGISTERED);
    expect(finalUpdate(ctx).operationsRecorded).toBe(1);
  });

  it('un documento inconsistente no escribe nada', async () => {
    const ctx = setup({
      text: `Órdenes de compra de Acciones Fraccionadas ejecutadas (5)
${row(1, '9000000001', 'CSPX.UK')}
`,
    });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    expect(finalUpdate(ctx).error).toContain('anuncia 5 órdenes');
    expect(ctx.transactionsService.createBatch).not.toHaveBeenCalled();
  });

  it('una venta sin lotes queda FAILED y dice qué hacer', async () => {
    const ctx = setup({
      createBatch: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException('No hay cantidad suficiente del instrumento'),
        ),
    });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    const { error } = finalUpdate(ctx);
    expect(error).toContain('No hay cantidad suficiente');
    expect(error).toContain('CSPX.UK');
    expect(error).toContain('reprocesa');
  });

  it.each([
    [
      'la tasa no es 1',
      {
        text: `Órdenes de compra de Acciones Fraccionadas ejecutadas (1)
${row(1, '9000000001', 'CSPX.UK').replace('USD 1.0000', 'USD 0.9200')}
`,
      },
    ],
    ['la cuenta está en otra moneda', { accountCurrency: 'EUR' }],
  ])('rechaza el documento si %s', async (_case, options) => {
    const ctx = setup(options);
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    expect(finalUpdate(ctx).error).toContain('no puede representarla');
    expect(ctx.instrumentsService.resolveOrCreate).not.toHaveBeenCalled();
    expect(ctx.transactionsService.createBatch).not.toHaveBeenCalled();
  });

  it('rechaza un instrumento del catálogo en otra moneda', async () => {
    const ctx = setup({ instrumentCurrency: 'EUR' });
    await expect(ctx.ingest()).resolves.toBe(MailMessageStatus.FAILED);
    expect(finalUpdate(ctx).error).toContain('CSPX');
    expect(ctx.transactionsService.createBatch).not.toHaveBeenCalled();
  });

  it('sin PDF, o con un PDF que no es una confirmación, no hay nada que registrar', async () => {
    const noPdf = setup({ attachments: [] });
    await expect(noPdf.ingest()).resolves.toBe(MailMessageStatus.NO_INVOICE);

    const other = setup({ text: 'Extracto mensual de la cuenta' });
    await expect(other.ingest()).resolves.toBe(MailMessageStatus.NO_INVOICE);
    expect(other.transactionsService.createBatch).not.toHaveBeenCalled();
  });

  it('reprocesar tras corregir la contraseña registra el correo', async () => {
    const ctx = setup();
    const message = await ctx.ingestion.retry('msg-1', 'user-1');

    expect(message.id).toBe('msg-1');
    expect(ctx.transactionsService.createBatch).toHaveBeenCalledTimes(1);
    expect(finalUpdate(ctx).status).toBe(MailMessageStatus.REGISTERED);
  });
});

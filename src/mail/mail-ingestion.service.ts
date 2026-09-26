import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { ArticleType } from '../articles/entities/article.entity';
import { CreateExpenseInput } from '../transactions/dto/create-expense.input';
import { ExpenseItemInput } from '../transactions/dto/expense-item.input';
import { Expense } from '../transactions/entities/expense.entity';
import { ExpensesService } from '../transactions/expenses.service';
import { MailMessagesFilterInput } from './dto/mail-sender.input';
import { MailConnection } from './entities/mail-connection.entity';
import { MailInvoice } from './entities/mail-invoice.entity';
import { MailMessage, MailMessageStatus } from './entities/mail-message.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailApi, GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { extractXmlDocuments } from './parsing/attachment-extractor';
import { ParsedInvoice, parseDianInvoice } from './parsing/ubl-invoice.parser';

const MAX_MESSAGES_PAGE = 200;

// estados desde los que un correo se puede reprocesar a mano
const RETRYABLE = [MailMessageStatus.FAILED, MailMessageStatus.PROCESSING];

// De un correo a un gasto: descarga los adjuntos, saca el XML, lo interpreta
// y registra el gasto en la cuenta por defecto del remitente.
//
// Dos cerrojos lo hacen idempotente:
//  1. mail_messages (connection_id, gmail_message_id): el push, la lectura de
//     antiguos y el job de respaldo pueden ver el mismo correo; solo el que
//     inserta la fila lo procesa.
//  2. mail_invoices (user_id, cufe): la misma factura en dos correos distintos
//     se registra una sola vez.
@Injectable()
export class MailIngestionService {
  private readonly logger = new Logger(MailIngestionService.name);

  constructor(
    @InjectRepository(MailMessage)
    private readonly messagesRepository: Repository<MailMessage>,
    @InjectRepository(MailInvoice)
    private readonly invoicesRepository: Repository<MailInvoice>,
    @InjectRepository(MailSender)
    private readonly sendersRepository: Repository<MailSender>,
    private readonly gmailClient: GmailClientService,
    private readonly connectionsService: MailConnectionsService,
    private readonly articlesService: ArticlesService,
    private readonly expensesService: ExpensesService,
  ) {}

  // bitácora de correos procesados, del más reciente al más antiguo
  findMessages(
    userId: string,
    filter?: MailMessagesFilterInput,
  ): Promise<MailMessage[]> {
    return this.messagesRepository.find({
      where: {
        userId,
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.senderId ? { senderId: filter.senderId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(filter?.limit ?? 50, 1), MAX_MESSAGES_PAGE),
    });
  }

  /**
   * Procesa un correo si viene de un remitente configurado. Devuelve el
   * estado final, o null si el correo no interesa o ya lo procesó otra vía.
   * Los correos de otros remitentes no dejan rastro: solo se leen cabeceras.
   */
  async ingest(
    connection: MailConnection,
    api: GmailApi,
    messageId: string,
    senders: Map<string, MailSender>,
  ): Promise<MailMessageStatus | null> {
    const meta = await this.gmailClient.getMeta(api, messageId);
    const sender = meta.from ? senders.get(meta.from) : undefined;
    if (!sender) {
      return null;
    }

    const inserted = await this.messagesRepository
      .createQueryBuilder()
      .insert()
      .into(MailMessage)
      .values({
        userId: connection.userId,
        connectionId: connection.id,
        gmailMessageId: messageId,
        senderId: sender.id,
        subject: meta.subject,
        receivedAt: meta.receivedAt,
        status: MailMessageStatus.PROCESSING,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const id = (inserted.raw as { id: string }[])[0]?.id;
    if (!id) {
      return null;
    }

    const message = await this.messagesRepository.findOneByOrFail({ id });
    return this.process(message, sender, api);
  }

  // Reprocesa un correo que falló (p. ej. la tarjeta no tenía cupo y ya se
  // pagó, o faltaba configurar la cuenta).
  async retry(id: string, userId: string): Promise<MailMessage> {
    const message = await this.messagesRepository.findOne({
      where: { id, userId },
    });
    if (!message) {
      throw new NotFoundException(`Correo ${id} no encontrado`);
    }
    if (!RETRYABLE.includes(message.status)) {
      throw new BadRequestException(
        `Solo se reprocesan correos fallidos (este está en ${message.status})`,
      );
    }
    const sender = message.senderId
      ? await this.sendersRepository.findOne({
          where: { id: message.senderId },
        })
      : null;
    if (!sender) {
      throw new BadRequestException(
        'El remitente de este correo ya no está configurado',
      );
    }
    const connection = await this.connectionsService.findOne(
      message.connectionId,
      userId,
    );

    // una caída a mitad deja la factura reservada sin gasto: se libera
    await this.invoicesRepository.delete({
      mailMessageId: message.id,
      expenseId: IsNull(),
    });
    await this.messagesRepository.update(
      { id: message.id },
      { status: MailMessageStatus.PROCESSING, error: null },
    );
    await this.process(
      message,
      sender,
      this.connectionsService.gmailFor(connection),
    );
    return this.messagesRepository.findOneByOrFail({ id: message.id });
  }

  private async process(
    message: MailMessage,
    sender: MailSender,
    api: GmailApi,
  ): Promise<MailMessageStatus> {
    try {
      const attachments = await this.gmailClient.getInvoiceAttachments(
        api,
        message.gmailMessageId,
      );
      const invoice = (await extractXmlDocuments(attachments))
        .map(parseDianInvoice)
        .find((parsed): parsed is ParsedInvoice => parsed !== null);
      if (!invoice) {
        return this.finish(
          message,
          MailMessageStatus.NO_INVOICE,
          'El correo no trae una factura electrónica en XML',
        );
      }

      const reservation = await this.reserveInvoice(message, invoice);
      if (!reservation) {
        return this.finish(
          message,
          MailMessageStatus.DUPLICATE,
          `La factura ${invoice.number} ya estaba registrada`,
        );
      }

      let expense: Expense;
      try {
        expense = await this.registerExpense(message.userId, sender, invoice);
      } catch (error) {
        // se libera la reserva para que un reintento pueda registrarla
        await this.invoicesRepository.delete({ id: reservation });
        throw error;
      }
      await this.invoicesRepository.update(
        { id: reservation },
        { expenseId: expense.id },
      );
      return this.finish(
        message,
        MailMessageStatus.REGISTERED,
        null,
        expense.id,
      );
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.warn(
        `No se pudo registrar el correo ${message.gmailMessageId}: ${reason}`,
      );
      return this.finish(message, MailMessageStatus.FAILED, reason);
    }
  }

  // Inserta la factura por CUFE. Devuelve su id, o null si ya existía.
  private async reserveInvoice(
    message: MailMessage,
    invoice: ParsedInvoice,
  ): Promise<string | null> {
    const inserted = await this.invoicesRepository
      .createQueryBuilder()
      .insert()
      .into(MailInvoice)
      .values({
        userId: message.userId,
        cufe: invoice.cufe,
        invoiceNumber: invoice.number,
        issuerNit: invoice.issuerNit,
        issuerName: invoice.issuerName,
        issueDate: invoice.issueDate,
        total: invoice.total,
        currency: invoice.currency,
        mailMessageId: message.id,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    return (inserted.raw as { id: string }[])[0]?.id ?? null;
  }

  private async registerExpense(
    userId: string,
    sender: MailSender,
    invoice: ParsedInvoice,
  ): Promise<Expense> {
    const input: CreateExpenseInput = {
      description: `${sender.merchantName} · factura ${invoice.number}`,
      occurredOn: invoice.issueDate,
      currency: invoice.currency,
      merchant: sender.merchantName || invoice.issuerName,
      accountId: sender.defaultAccountId ?? undefined,
      categoryId: sender.defaultCategoryId ?? undefined,
      notes: `Factura electrónica ${invoice.number} de ${invoice.issuerName}. CUFE: ${invoice.cufe}`,
    };

    if (invoice.items.length > 0) {
      input.items = await this.resolveItems(userId, invoice);
    } else {
      input.amount = invoice.total;
    }
    return this.expensesService.create(userId, input);
  }

  // En serie y no en paralelo: dos líneas del mismo producto en una factura
  // crearían el artículo dos veces a la vez.
  private async resolveItems(
    userId: string,
    invoice: ParsedInvoice,
  ): Promise<ExpenseItemInput[]> {
    const items: ExpenseItemInput[] = [];
    for (const line of invoice.items) {
      const article = await this.articlesService.findOrCreateByName(userId, {
        name: line.description,
        type: ArticleType.PRODUCT,
        barcode: line.barcode,
      });
      items.push({
        articleId: article.id,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discount: line.discount || undefined,
      });
    }
    return items;
  }

  private async finish(
    message: MailMessage,
    status: MailMessageStatus,
    error: string | null,
    expenseId: string | null = null,
  ): Promise<MailMessageStatus> {
    await this.messagesRepository.update(
      { id: message.id },
      { status, error, expenseId },
    );
    return status;
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ArticlesService } from '../articles/articles.service';
import { Article, ArticleType } from '../articles/entities/article.entity';
import { CategorizationQueue } from '../categorization/categorization-queue';
import { CategoryClassifierService } from '../categorization/category-classifier.service';
import { roundAmount } from '../common/discount';
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
import {
  ParsedInvoice,
  ParsedInvoiceLine,
  parseDianInvoice,
} from './parsing/ubl-invoice.parser';

const MAX_MESSAGES_PAGE = 200;

// línea de la factura con su artículo del catálogo ya resuelto
interface ResolvedLine {
  line: ParsedInvoiceLine;
  article: Article;
  item: ExpenseItemInput;
}

// gasto recién registrado y lo que necesita su clasificación en segundo plano
interface RegisteredExpense {
  expense: Expense;
  lines: ResolvedLine[];
}

// contexto de la clasificación en segundo plano de un gasto ya registrado
interface CategorizationJob {
  userId: string;
  sender: MailSender;
  invoice: ParsedInvoice;
  lines: ResolvedLine[];
  expenseId: string;
  // la categoría con la que quedó el gasto al registrarse
  initialCategoryId: string | null;
}

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
//
// La clasificación con Jev va DESPUÉS y fuera del camino crítico: el gasto se
// registra con la categoría por defecto del remitente (o la heredada de su
// único ítem) y, ya marcado el correo como registrado, se encola la
// clasificación de los artículos y del gasto.
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
    private readonly classifier: CategoryClassifierService,
    private readonly categorizationQueue: CategorizationQueue,
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

      let registered: RegisteredExpense;
      try {
        registered = await this.registerExpense(
          message.userId,
          sender,
          invoice,
        );
      } catch (error) {
        // se libera la reserva para que un reintento pueda registrarla
        await this.invoicesRepository.delete({ id: reservation });
        throw error;
      }
      const { expense, lines } = registered;
      await this.invoicesRepository.update(
        { id: reservation },
        { expenseId: expense.id },
      );
      const status = await this.finish(
        message,
        MailMessageStatus.REGISTERED,
        null,
        expense.id,
      );
      this.enqueueCategorization({
        userId: message.userId,
        sender,
        invoice,
        lines,
        expenseId: expense.id,
        initialCategoryId: expense.categoryId ?? null,
      });
      return status;
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
  ): Promise<RegisteredExpense> {
    const merchant = sender.merchantName || invoice.issuerName;
    const input: CreateExpenseInput = {
      description: `${sender.merchantName} · factura ${invoice.number}`,
      occurredOn: invoice.issueDate,
      currency: invoice.currency,
      merchant,
      accountId: sender.defaultAccountId ?? undefined,
      notes: `Factura electrónica ${invoice.number} de ${invoice.issuerName}. CUFE: ${invoice.cufe}`,
    };

    const lines =
      invoice.items.length > 0 ? await this.resolveItems(userId, invoice) : [];
    if (lines.length > 0) {
      input.items = lines.map((line) => line.item);
    } else {
      input.amount = invoice.total;
    }

    // sin Jev: la por defecto del remitente, que gana en
    // ExpensesService.resolveCategory; sin ella, con un solo ítem se hereda la
    // de su artículo (o null si aún no tiene)
    input.categoryId = sender.defaultCategoryId ?? undefined;
    const expense = await this.expensesService.create(userId, input);
    return { expense, lines };
  }

  // En serie y no en paralelo: dos líneas del mismo producto en una factura
  // crearían el artículo dos veces a la vez.
  private async resolveItems(
    userId: string,
    invoice: ParsedInvoice,
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const line of invoice.items) {
      const article = await this.articlesService.findOrCreateByName(userId, {
        name: line.description,
        type: ArticleType.PRODUCT,
        barcode: line.barcode,
      });
      lines.push({
        line,
        article,
        item: {
          articleId: article.id,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          discount: line.discount || undefined,
        },
      });
    }
    return lines;
  }

  // vuelve de inmediato; un fallo de la tarea solo queda en el log
  private enqueueCategorization(job: CategorizationJob): void {
    this.categorizationQueue.enqueue(`factura ${job.invoice.number}`, () =>
      this.categorize(job),
    );
  }

  /**
   * Clasifica la compra con Jev, ya con el gasto registrado. Solo se pregunta
   * por los artículos que aún no tienen categoría; los demás dan contexto a la
   * compra completa. La sugerencia se guarda en el artículo únicamente si
   * sigue sin categoría: nunca se pisa la que puso el usuario. La categoría
   * del gasto se cambia solo si sigue siendo la del registro, para no pisar
   * una edición hecha entretanto.
   */
  private async categorize(job: CategorizationJob): Promise<void> {
    const { userId, sender, invoice, lines } = job;
    const merchant = sender.merchantName || invoice.issuerName;
    const asked = new Set<string>();
    const result = await this.classifier.classify({
      userId,
      // sin líneas, el emisor es lo único que describe la compra
      merchant:
        sender.merchantName && sender.merchantName !== invoice.issuerName
          ? `${merchant} (${invoice.issuerName})`
          : merchant,
      defaultCategoryId: sender.defaultCategoryId,
      items: lines.map(({ line, article }) => {
        // una pregunta por artículo aunque aparezca en varias líneas
        const classify = !article.categoryId && !asked.has(article.id);
        asked.add(article.id);
        return {
          key: article.id,
          name: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: roundAmount(
            line.unitPrice * line.quantity - line.discount,
          ),
          classify,
        };
      }),
    });

    if (result.classified) {
      this.logger.log(
        `Clasificación de la factura ${invoice.number}: compra=${result.invoiceCategoryId ?? 'ninguna'} (confianza ${result.signals.invoice?.confidence.toFixed(2) ?? '-'}), noul por defecto=${result.signals.defaultNoul?.toFixed(2) ?? '-'}, gasto=${result.expenseCategoryId ?? 'ninguna'}`,
      );
    }
    for (const [articleId, categoryId] of Object.entries(result.items)) {
      if (!categoryId) {
        continue;
      }
      try {
        await this.articlesService.assignCategoryIfMissing(
          userId,
          articleId,
          categoryId,
        );
      } catch (error) {
        this.logger.warn(
          `No se pudo guardar la categoría sugerida del artículo ${articleId}: ${(error as Error).message}`,
        );
      }
    }
    await this.updateExpenseCategory(job, result.expenseCategoryId);
  }

  private async updateExpenseCategory(
    job: CategorizationJob,
    categoryId: string | null,
  ): Promise<void> {
    if (!categoryId || categoryId === job.initialCategoryId) {
      return;
    }
    // Con categoría y sin por defecto del remitente, la heredó de su único
    // artículo, que ya estaba categorizado: esa se respeta. resolveExpenseCategory
    // ya aplicó la regla del noul cuando la por defecto existe.
    if (job.initialCategoryId && !job.sender.defaultCategoryId) {
      return;
    }
    const changed = await this.expensesService.updateCategoryIfUnchanged(
      job.userId,
      job.expenseId,
      job.initialCategoryId,
      categoryId,
    );
    if (!changed) {
      this.logger.log(
        `La categoría del gasto ${job.expenseId} cambió desde su registro; se conserva`,
      );
    }
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

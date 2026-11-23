import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InvestmentTransactionType } from '../common/enums/investment-transaction-type.enum';
import { roundMoney, roundQuantity } from '../investments/analytics/money';
import { InvestmentAccount } from '../investments/entities/investment-account.entity';
import { PdfStatementService } from '../investments/import/pdf-statement.service';
import { InvestmentAccountsService } from '../investments/investment-accounts.service';
import {
  BatchTransactionInput,
  InvestmentTransactionsService,
} from '../investments/investment-transactions.service';
import { InstrumentAssetClass } from '../market-data/entities/instrument.entity';
import { InstrumentsService } from '../market-data/instruments.service';
import { MailMessage, MailMessageStatus } from './entities/mail-message.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailApi, GmailClientService } from './gmail/gmail-client.service';
import { MailSendersService } from './mail-senders.service';
import {
  XtbOrder,
  parseXtbOrderConfirmation,
} from './parsing/xtb-order-confirmation.parser';

// por debajo de esto, la tasa del PDF es 1
const FX_ONE_TOLERANCE = 1e-6;

export interface XtbRecordOutcome {
  status: MailMessageStatus;
  // lo que se guarda en la bitácora; nunca lleva la contraseña
  note: string | null;
  operationsRecorded: number | null;
}

// De una confirmación de órdenes de XTB al libro de inversiones: abre el PDF,
// lo interpreta y registra sus órdenes en la cuenta del remitente.
//
// La idempotencia es la del libro: dedupe_hash + índice único, que cubre el
// mismo correo reenviado o leído por dos vías. NO cubre una orden ya importada
// del CSV/XLSX de XTB: ese perfil no produce la misma clave natural (importe y
// redondeo distintos). Un fallo lanza y la bitácora queda en FAILED con el
// mensaje; reprocesar es seguro porque la escritura es una sola transacción.
@Injectable()
export class XtbOrderConfirmationsService {
  private readonly logger = new Logger(XtbOrderConfirmationsService.name);

  constructor(
    private readonly gmailClient: GmailClientService,
    private readonly sendersService: MailSendersService,
    private readonly pdfService: PdfStatementService,
    private readonly accountsService: InvestmentAccountsService,
    private readonly transactionsService: InvestmentTransactionsService,
    private readonly instrumentsService: InstrumentsService,
  ) {}

  async record(
    message: MailMessage,
    sender: MailSender,
    api: GmailApi,
  ): Promise<XtbRecordOutcome> {
    const { userId } = message;
    if (!sender.investmentAccountId) {
      throw new BadRequestException(
        `El remitente ${sender.emailAddress} no tiene cuenta de inversión: configúrala y reprocesa este correo`,
      );
    }
    const password = this.sendersService.attachmentPasswordOf(sender);
    if (!password) {
      throw new BadRequestException(
        `El remitente ${sender.emailAddress} no tiene contraseña de PDF: configúrala y reprocesa este correo`,
      );
    }
    const account = await this.accountsService.findOne(
      sender.investmentAccountId,
      userId,
    );

    const attachments = await this.gmailClient.getPdfAttachments(
      api,
      message.gmailMessageId,
    );
    const inputs: BatchTransactionInput[] = [];
    const sells = new Set<string>();
    for (const attachment of attachments) {
      const { text } = await this.pdfService.extractText(
        attachment.data,
        password,
      );
      const orders = parseXtbOrderConfirmation(text);
      inputs.push(...(await this.toInputs(account, orders)));
      orders
        .filter((order) => order.side === 'SELL')
        .forEach((order) => sells.add(order.ticker));
    }
    if (inputs.length === 0) {
      return {
        status: MailMessageStatus.NO_INVOICE,
        note: 'El correo no trae una confirmación de órdenes en PDF',
        operationsRecorded: null,
      };
    }

    const { inserted } = await this.write(userId, account.id, inputs, sells);
    this.logger.log(
      `Correo ${message.gmailMessageId}: ${inserted} de ${inputs.length} operaciones registradas`,
    );
    return inserted === 0
      ? {
          status: MailMessageStatus.DUPLICATE,
          note: `Las ${inputs.length} operaciones del correo ya estaban registradas`,
          operationsRecorded: 0,
        }
      : {
          status: MailMessageStatus.REGISTERED,
          note: null,
          operationsRecorded: inserted,
        };
  }

  // Una venta sin lotes suficientes la rechaza el libro y no queda nada escrito.
  // El mensaje del libro no sabe de correos: aquí se le añade qué hacer.
  private async write(
    userId: string,
    accountId: string,
    inputs: BatchTransactionInput[],
    sells: Set<string>,
  ): Promise<{ inserted: number }> {
    try {
      return await this.transactionsService.createBatch(
        userId,
        accountId,
        inputs,
      );
    } catch (error) {
      if (error instanceof BadRequestException && sells.size > 0) {
        throw new BadRequestException(
          `${error.message}. Ventas del documento: ${[...sells].join(', ')}. ` +
            'Si falta la compra en el libro (histórico incompleto o correos fuera de orden), ' +
            'regístrala o espera a que llegue su correo y reprocesa este',
        );
      }
      throw error;
    }
  }

  // La posición dentro del documento decide occurrenceIndex: dos órdenes
  // idénticas el mismo día son operaciones distintas, y el mismo documento
  // reprocesado les da los mismos índices.
  private async toInputs(
    account: InvestmentAccount,
    orders: XtbOrder[],
  ): Promise<BatchTransactionInput[]> {
    // antes de crear instrumentos; la moneda de uno ya existente se valida
    // después, así que ese rechazo puede dejar creados los anteriores
    orders.forEach((order) => this.assertRepresentable(account, order));

    const seen = new Map<string, number>();
    const inputs: BatchTransactionInput[] = [];
    for (const order of orders) {
      const instrumentId = await this.resolveInstrument(order);
      const type =
        order.side === 'BUY'
          ? InvestmentTransactionType.BUY
          : InvestmentTransactionType.SELL;
      const naturalKey = [
        type,
        order.occurredOn,
        instrumentId,
        roundQuantity(order.volume),
        roundMoney(order.total),
        order.quoteCurrency,
      ].join('|');
      const occurrenceIndex = seen.get(naturalKey) ?? 0;
      seen.set(naturalKey, occurrenceIndex + 1);

      inputs.push({
        accountId: account.id,
        type,
        instrumentId,
        occurredOn: order.occurredOn,
        // El PDF no dice la zona horaria: se guarda como UTC solo para ordenar
        // dentro del día, que es para lo que usa esta hora el libro. La fecha
        // sale de occurredOn, así que no se puede correr de día.
        occurredAt: new Date(`${order.occurredOn}T${order.time}Z`),
        quantity: order.volume,
        price: order.price,
        amount: order.total,
        fee: order.commission + order.fxCommission,
        currency: order.quoteCurrency,
        occurrenceIndex,
        notes: `Confirmación de XTB, orden ${order.orderId}`,
        externalId: order.orderId,
        raw: {
          source: 'xtb-order-confirmation',
          orderId: order.orderId,
          ticker: order.ticker,
          time: order.time,
          executionSystem: order.executionSystem,
          orderType: order.orderType,
          assetType: order.assetType,
          fxRate: order.fxRate,
          fxCommission: order.fxCommission,
          commission: order.commission,
        },
      });
    }
    return inputs;
  }

  // La tasa del PDF es de la moneda de cotización a la de la cuenta, y el efectivo
  // del libro se mueve en la moneda de la operación. Si no coinciden, habría que
  // inventar un cambio de divisa que el documento no detalla: mejor rechazarlo.
  private assertRepresentable(
    account: InvestmentAccount,
    order: XtbOrder,
  ): void {
    if (
      Math.abs(order.fxRate - 1) > FX_ONE_TOLERANCE ||
      order.quoteCurrency !== account.currency
    ) {
      throw new BadRequestException(
        `La orden ${order.orderId} (${order.ticker}) cotiza en ${order.quoteCurrency} con tasa ${order.fxRate} ` +
          `y la cuenta está en ${account.currency}: el libro no puede representarla fielmente`,
      );
    }
  }

  // Mismo criterio que la importación de statements, para que un ticker caiga en
  // el mismo instrumento venga por donde venga; si es nuevo se crea como en la
  // sincronización con brókers. Sin el sufijo de mercado para pedirle precios a
  // Twelve Data, que no entiende "NVDA.US".
  private async resolveInstrument(order: XtbOrder): Promise<string> {
    const instrument =
      (await this.instrumentsService.findByBrokerSymbol(order.ticker)) ??
      (await this.instrumentsService.resolveOrCreate(order.ticker, {
        name: order.instrumentName,
        currency: order.quoteCurrency,
        assetClass: /etf/i.test(order.assetType)
          ? InstrumentAssetClass.ETF
          : InstrumentAssetClass.EQUITY,
        twelveDataSymbol: order.ticker.split('.')[0],
      }));
    if (instrument.currency !== order.quoteCurrency) {
      throw new BadRequestException(
        `La orden ${order.orderId} cotiza en ${order.quoteCurrency} y el instrumento ${instrument.symbol} está en ${instrument.currency}`,
      );
    }
    return instrument.id;
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { CURRENT_KEY_VERSION, SecretBox } from '../common/crypto/secret-box';
import { InvestmentAccountsService } from '../investments/investment-accounts.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import {
  CreateMailSenderInput,
  UpdateMailSenderInput,
} from './dto/mail-sender.input';
import {
  MailBackfillStatus,
  MailSender,
  MailSenderKind,
} from './entities/mail-sender.entity';
import {
  MAIL_SECRET_BOX,
  MailConnectionsService,
} from './mail-connections.service';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Remitentes configurados: QUÉ correos se leen y con qué comercio y cuenta se
// registran sus facturas u órdenes.
//
// Ningún método devuelve la contraseña de los adjuntos al exterior:
// `attachmentPasswordOf` la abre solo para quien lee el PDF.
@Injectable()
export class MailSendersService {
  constructor(
    @InjectRepository(MailSender)
    private readonly sendersRepository: Repository<MailSender>,
    private readonly connectionsService: MailConnectionsService,
    private readonly accountsService: PaymentMethodsService,
    private readonly categoriesService: CategoriesService,
    private readonly investmentAccountsService: InvestmentAccountsService,
    @Inject(MAIL_SECRET_BOX) private readonly secretBox: SecretBox,
  ) {}

  findAll(userId: string, connectionId?: string): Promise<MailSender[]> {
    return this.sendersRepository.find({
      where: { userId, ...(connectionId ? { connectionId } : {}) },
      relations: {
        defaultAccount: true,
        defaultCategory: true,
        investmentAccount: true,
      },
      order: { merchantName: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<MailSender> {
    const sender = await this.sendersRepository.findOne({
      where: { id, userId },
      relations: {
        defaultAccount: true,
        defaultCategory: true,
        investmentAccount: true,
      },
    });
    if (!sender) {
      throw new NotFoundException(`Remitente ${id} no encontrado`);
    }
    return sender;
  }

  // remitentes activos de un buzón, indexados por dirección
  async activeByAddress(
    connectionId: string,
  ): Promise<Map<string, MailSender>> {
    const senders = await this.sendersRepository.find({
      where: { connectionId, active: true },
    });
    return new Map(senders.map((s) => [s.emailAddress, s]));
  }

  async create(
    userId: string,
    input: CreateMailSenderInput,
  ): Promise<MailSender> {
    await this.connectionsService.findOne(input.connectionId, userId);
    await this.assertReferences(userId, input);
    if (input.backfillFrom && !DATE.test(input.backfillFrom)) {
      throw new BadRequestException('backfillFrom debe ser YYYY-MM-DD');
    }
    const kind = input.kind ?? MailSenderKind.INVOICE;
    this.assertXtbReady(
      kind,
      input.investmentAccountId,
      input.attachmentPassword !== undefined,
    );
    const emailAddress = this.normalizeEmail(input.emailAddress);
    await this.assertUnique(input.connectionId, emailAddress);

    // El AAD ata la contraseña a ESTA fila, así que el id se genera aquí: si
    // sellar falla no queda un remitente a medio crear.
    const id = randomUUID();
    const sender = await this.sendersRepository.save(
      this.sendersRepository.create({
        id,
        ...this.sealedPassword(id, input.attachmentPassword),
        kind,
        investmentAccountId: input.investmentAccountId ?? null,
        userId,
        connectionId: input.connectionId,
        emailAddress,
        merchantName: this.requireText(input.merchantName, 'merchantName'),
        defaultAccountId: input.defaultAccountId ?? null,
        defaultCategoryId: input.defaultCategoryId ?? null,
        backfillFrom: input.backfillFrom ?? null,
      }),
    );
    return this.findOne(sender.id, userId);
  }

  async update(
    userId: string,
    input: UpdateMailSenderInput,
  ): Promise<MailSender> {
    const sender = await this.findOne(input.id, userId);
    await this.assertReferences(userId, input);

    if (input.emailAddress !== undefined) {
      const emailAddress = this.normalizeEmail(input.emailAddress);
      if (emailAddress !== sender.emailAddress) {
        await this.assertUnique(sender.connectionId, emailAddress);
      }
      sender.emailAddress = emailAddress;
    }
    if (input.merchantName !== undefined) {
      sender.merchantName = this.requireText(
        input.merchantName,
        'merchantName',
      );
    }
    // null explícito quita la cuenta o la categoría por defecto
    if (input.defaultAccountId !== undefined) {
      sender.defaultAccountId = input.defaultAccountId ?? null;
    }
    if (input.defaultCategoryId !== undefined) {
      sender.defaultCategoryId = input.defaultCategoryId ?? null;
    }
    if (input.investmentAccountId !== undefined) {
      sender.investmentAccountId = input.investmentAccountId ?? null;
    }
    if (input.kind !== undefined && input.kind !== null) {
      sender.kind = input.kind;
    }
    if (input.active !== undefined && input.active !== null) {
      sender.active = input.active;
    }
    this.assertXtbReady(
      sender.kind,
      sender.investmentAccountId,
      input.attachmentPassword !== undefined
        ? input.attachmentPassword !== null
        : !!sender.attachmentPasswordCiphertext,
    );
    // update y no save: con las relaciones cargadas, save volvería a
    // escribir los ids viejos desde defaultAccount/defaultCategory
    await this.sendersRepository.update(
      { id: sender.id },
      {
        emailAddress: sender.emailAddress,
        merchantName: sender.merchantName,
        defaultAccountId: sender.defaultAccountId,
        defaultCategoryId: sender.defaultCategoryId,
        investmentAccountId: sender.investmentAccountId,
        kind: sender.kind,
        active: sender.active,
        // sin el campo, la contraseña guardada no se toca
        ...(input.attachmentPassword !== undefined
          ? this.sealedPassword(sender.id, input.attachmentPassword)
          : {}),
      },
    );
    return this.findOne(sender.id, userId);
  }

  // ÚNICO punto de descifrado de la contraseña de los adjuntos.
  attachmentPasswordOf(sender: MailSender): string | null {
    if (
      !sender.attachmentPasswordCiphertext ||
      !sender.attachmentPasswordIv ||
      !sender.attachmentPasswordTag
    ) {
      return null;
    }
    return this.secretBox.open(
      {
        ciphertext: sender.attachmentPasswordCiphertext,
        iv: sender.attachmentPasswordIv,
        tag: sender.attachmentPasswordTag,
        keyVersion: sender.attachmentPasswordKeyVersion,
      },
      sender.id,
    );
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const sender = await this.findOne(id, userId);
    await this.sendersRepository.remove(sender);
    return true;
  }

  async setBackfill(
    id: string,
    status: MailBackfillStatus,
    error: string | null = null,
    backfillFrom?: string | null,
  ): Promise<void> {
    await this.sendersRepository.update(
      { id },
      {
        backfillStatus: status,
        backfillError: error,
        ...(backfillFrom !== undefined ? { backfillFrom } : {}),
      },
    );
  }

  private async assertReferences(
    userId: string,
    input: {
      defaultAccountId?: string | null;
      defaultCategoryId?: string | null;
      investmentAccountId?: string | null;
    },
  ): Promise<void> {
    await this.accountsService.assertOwned(input.defaultAccountId, userId);
    await this.investmentAccountsService.assertOwned(
      input.investmentAccountId,
      userId,
    );
    if (input.defaultCategoryId) {
      await this.categoriesService.findOne(input.defaultCategoryId, userId);
    }
  }

  // Sin cuenta de inversión o sin contraseña, todo correo de XTB terminaría en
  // FAILED: se rechaza al guardar el remitente en vez de descubrirlo después.
  private assertXtbReady(
    kind: MailSenderKind,
    investmentAccountId: string | null | undefined,
    hasPassword: boolean,
  ): void {
    if (kind !== MailSenderKind.XTB_ORDER_CONFIRMATION) return;
    if (!investmentAccountId) {
      throw new BadRequestException(
        'Un remitente de XTB necesita una cuenta de inversión',
      );
    }
    if (!hasPassword) {
      throw new BadRequestException(
        'Un remitente de XTB necesita la contraseña del PDF',
      );
    }
  }

  private async assertUnique(
    connectionId: string,
    emailAddress: string,
  ): Promise<void> {
    const existing = await this.sendersRepository.findOne({
      where: { connectionId, emailAddress },
    });
    if (existing) {
      throw new ConflictException(
        `El remitente ${emailAddress} ya está configurado en este buzón`,
      );
    }
  }

  // Columnas de la contraseña: selladas, o vacías si no hay (null la borra). No
  // se recorta: los espacios pueden ser parte de la contraseña del PDF.
  private sealedPassword(
    senderId: string,
    password: string | null | undefined,
  ): Pick<
    MailSender,
    | 'attachmentPasswordCiphertext'
    | 'attachmentPasswordIv'
    | 'attachmentPasswordTag'
    | 'attachmentPasswordKeyVersion'
  > {
    if (password === null || password === undefined) {
      return {
        attachmentPasswordCiphertext: null,
        attachmentPasswordIv: null,
        attachmentPasswordTag: null,
        attachmentPasswordKeyVersion: CURRENT_KEY_VERSION,
      };
    }
    if (!password.trim()) {
      throw new BadRequestException(
        'attachmentPassword no puede estar vacía; envía null para borrarla',
      );
    }
    const sealed = this.secretBox.seal(password, senderId);
    return {
      attachmentPasswordCiphertext: sealed.ciphertext,
      attachmentPasswordIv: sealed.iv,
      attachmentPasswordTag: sealed.tag,
      attachmentPasswordKeyVersion: sealed.keyVersion,
    };
  }

  private normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      throw new BadRequestException(`"${value}" no es una dirección válida`);
    }
    return email;
  }

  private requireText(value: string, field: string): string {
    const text = value?.trim();
    if (!text) {
      throw new BadRequestException(`${field} no puede estar vacío`);
    }
    return text;
  }
}

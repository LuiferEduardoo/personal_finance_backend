import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import {
  CreateMailSenderInput,
  UpdateMailSenderInput,
} from './dto/mail-sender.input';
import { MailBackfillStatus, MailSender } from './entities/mail-sender.entity';
import { MailConnectionsService } from './mail-connections.service';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Remitentes configurados: QUÉ correos se leen y con qué comercio y cuenta se
// registran sus facturas.
@Injectable()
export class MailSendersService {
  constructor(
    @InjectRepository(MailSender)
    private readonly sendersRepository: Repository<MailSender>,
    private readonly connectionsService: MailConnectionsService,
    private readonly accountsService: PaymentMethodsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  findAll(userId: string, connectionId?: string): Promise<MailSender[]> {
    return this.sendersRepository.find({
      where: { userId, ...(connectionId ? { connectionId } : {}) },
      relations: { defaultAccount: true, defaultCategory: true },
      order: { merchantName: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<MailSender> {
    const sender = await this.sendersRepository.findOne({
      where: { id, userId },
      relations: { defaultAccount: true, defaultCategory: true },
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
    const emailAddress = this.normalizeEmail(input.emailAddress);
    await this.assertUnique(input.connectionId, emailAddress);

    const sender = await this.sendersRepository.save(
      this.sendersRepository.create({
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
    if (input.active !== undefined && input.active !== null) {
      sender.active = input.active;
    }
    // update y no save: con las relaciones cargadas, save volvería a
    // escribir los ids viejos desde defaultAccount/defaultCategory
    await this.sendersRepository.update(
      { id: sender.id },
      {
        emailAddress: sender.emailAddress,
        merchantName: sender.merchantName,
        defaultAccountId: sender.defaultAccountId,
        defaultCategoryId: sender.defaultCategoryId,
        active: sender.active,
      },
    );
    return this.findOne(sender.id, userId);
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
    },
  ): Promise<void> {
    await this.accountsService.assertOwned(input.defaultAccountId, userId);
    if (input.defaultCategoryId) {
      await this.categoriesService.findOne(input.defaultCategoryId, userId);
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

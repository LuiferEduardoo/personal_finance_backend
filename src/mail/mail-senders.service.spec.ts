import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import { Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { SecretBox } from '../common/crypto/secret-box';
import { InvestmentAccountsService } from '../investments/investment-accounts.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { MailSender, MailSenderKind } from './entities/mail-sender.entity';
import { MailConnectionsService } from './mail-connections.service';
import { MailSendersResolver } from './mail-senders.resolver';
import { MailSendersService } from './mail-senders.service';

const PASSWORD = 'contraseña-secreta-de-prueba';
const secretBox = new SecretBox(
  { get: () => 'a'.repeat(64) } as unknown as ConfigService,
  { keyEnv: 'MAIL_ENCRYPTION_KEY', label: 'las conexiones de correo' },
);

function setup(stored: Partial<MailSender> = {}) {
  const row = {
    id: 'sender-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    emailAddress: 'confirmaciones@xtb.test',
    merchantName: 'XTB',
    kind: MailSenderKind.XTB_ORDER_CONFIRMATION,
    defaultAccountId: null,
    defaultCategoryId: null,
    investmentAccountId: 'inv-account-1',
    attachmentPasswordCiphertext: Buffer.from('sellada'),
    active: true,
    ...stored,
  } as MailSender;
  const repository = {
    create: jest.fn((value: Partial<MailSender>) => value),
    save: jest.fn((value: Partial<MailSender>) => Promise.resolve(value)),
    update: jest.fn(),
    findOne: jest.fn(({ where }: { where: { emailAddress?: string } }) =>
      Promise.resolve(where.emailAddress ? null : row),
    ),
  };
  const investmentAccounts = { assertOwned: jest.fn() };
  const service = new MailSendersService(
    repository as unknown as Repository<MailSender>,
    { findOne: jest.fn() } as unknown as MailConnectionsService,
    { assertOwned: jest.fn() } as unknown as PaymentMethodsService,
    { findOne: jest.fn() } as unknown as CategoriesService,
    investmentAccounts as unknown as InvestmentAccountsService,
    secretBox,
  );
  return { service, repository, investmentAccounts };
}

const createInput = {
  connectionId: 'conn-1',
  emailAddress: 'Confirmaciones@XTB.test',
  merchantName: 'XTB',
  kind: MailSenderKind.XTB_ORDER_CONFIRMATION,
  investmentAccountId: 'inv-account-1',
};

describe('MailSendersService: contraseña de los adjuntos', () => {
  it('al crear guarda solo el cifrado, atado al id del remitente', async () => {
    const { service, repository, investmentAccounts } = setup();

    await service.create('user-1', {
      ...createInput,
      attachmentPassword: PASSWORD,
    });

    const saved = repository.save.mock.calls[0][0] as MailSender;
    expect(saved.kind).toBe(MailSenderKind.XTB_ORDER_CONFIRMATION);
    expect(saved.investmentAccountId).toBe('inv-account-1');
    expect(investmentAccounts.assertOwned).toHaveBeenCalledWith(
      'inv-account-1',
      'user-1',
    );
    expect(JSON.stringify(saved)).not.toContain(PASSWORD);
    expect(saved.attachmentPasswordCiphertext?.toString()).not.toContain(
      PASSWORD,
    );

    // se abre con SU id y con ningún otro
    expect(service.attachmentPasswordOf(saved)).toBe(PASSWORD);
    expect(() =>
      service.attachmentPasswordOf({ ...saved, id: 'otro-remitente' }),
    ).toThrow('No se pudieron descifrar');
  });

  it('un remitente creado sin tipo es de facturas y no tiene contraseña', async () => {
    const { service, repository } = setup();

    await service.create('user-1', {
      connectionId: 'conn-1',
      emailAddress: 'facturas@tienda.test',
      merchantName: 'Tienda',
    });

    const saved = repository.save.mock.calls[0][0] as MailSender;
    expect(saved.kind).toBe(MailSenderKind.INVOICE);
    expect(saved.investmentAccountId).toBeNull();
    expect(saved.attachmentPasswordCiphertext).toBeNull();
    expect(service.attachmentPasswordOf(saved)).toBeNull();
  });

  it('actualizar sin el campo no toca la contraseña', async () => {
    const { service, repository } = setup();

    await service.update('user-1', { id: 'sender-1', merchantName: 'XTB 2' });

    const changes = repository.update.mock.calls[0][1] as Partial<MailSender>;
    expect(changes).not.toHaveProperty('attachmentPasswordCiphertext');
  });

  it('actualizar con null la borra (si no es de XTB)', async () => {
    const { service, repository } = setup({ kind: MailSenderKind.INVOICE });

    await service.update('user-1', {
      id: 'sender-1',
      attachmentPassword: null,
    });
    expect(repository.update.mock.calls[0][1]).toMatchObject({
      attachmentPasswordCiphertext: null,
      attachmentPasswordIv: null,
      attachmentPasswordTag: null,
    });
  });

  it('actualizar con texto la reemplaza cifrada', async () => {
    const { service, repository } = setup();

    await service.update('user-1', {
      id: 'sender-1',
      attachmentPassword: PASSWORD,
    });
    const changes = repository.update.mock.calls[0][1] as MailSender;
    expect(JSON.stringify(changes)).not.toContain(PASSWORD);
    expect(
      service.attachmentPasswordOf({
        ...changes,
        id: 'sender-1',
      }),
    ).toBe(PASSWORD);
  });

  it('una contraseña en blanco se rechaza sin repetirla', async () => {
    const { service } = setup();
    await expect(
      service.update('user-1', { id: 'sender-1', attachmentPassword: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un cambio de cuenta de inversión valida que sea del usuario', async () => {
    const { service, repository, investmentAccounts } = setup();

    await service.update('user-1', {
      id: 'sender-1',
      investmentAccountId: 'inv-account-2',
    });

    expect(investmentAccounts.assertOwned).toHaveBeenCalledWith(
      'inv-account-2',
      'user-1',
    );
    expect(repository.update.mock.calls[0][1]).toMatchObject({
      investmentAccountId: 'inv-account-2',
    });
  });
});

describe('MailSendersService: un remitente de XTB debe poder procesarse', () => {
  it('al crear exige la cuenta de inversión', async () => {
    const { service, repository } = setup();
    await expect(
      service.create('user-1', {
        ...createInput,
        investmentAccountId: undefined,
        attachmentPassword: PASSWORD,
      }),
    ).rejects.toThrow('cuenta de inversión');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('al crear exige la contraseña del PDF', async () => {
    const { service, repository } = setup();
    await expect(service.create('user-1', createInput)).rejects.toThrow(
      'contraseña del PDF',
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('no deja borrar la contraseña de un remitente de XTB', async () => {
    const { service, repository } = setup();
    await expect(
      service.update('user-1', { id: 'sender-1', attachmentPassword: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('no deja quitar la cuenta de inversión de un remitente de XTB', async () => {
    const { service, repository } = setup();
    await expect(
      service.update('user-1', { id: 'sender-1', investmentAccountId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('pasar un remitente de facturas a XTB exige cuenta y contraseña', async () => {
    const { service } = setup({
      kind: MailSenderKind.INVOICE,
      investmentAccountId: null,
      attachmentPasswordCiphertext: null,
    });
    await expect(
      service.update('user-1', {
        id: 'sender-1',
        kind: MailSenderKind.XTB_ORDER_CONFIRMATION,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('editar otro campo conserva la contraseña guardada y pasa', async () => {
    const { service, repository } = setup();
    await service.update('user-1', { id: 'sender-1', merchantName: 'XTB 2' });
    expect(repository.update).toHaveBeenCalled();
  });
});

describe('Esquema GraphQL del remitente', () => {
  it('la contraseña se puede escribir y nunca leer', async () => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, {
      logger: false,
    });
    await app.init();
    const schema = await app
      .get(GraphQLSchemaFactory)
      .create([MailSendersResolver]);
    await app.close();

    const sender = schema.getType('MailSender') as GraphQLObjectType;
    const sensitive = Object.keys(sender.getFields()).filter((field) =>
      /password|ciphertext|secret/i.test(field),
    );
    expect(sensitive).toEqual(['hasAttachmentPassword']);
    expect(String(sender.getFields().hasAttachmentPassword.type)).toBe(
      'Boolean!',
    );

    for (const input of ['CreateMailSenderInput', 'UpdateMailSenderInput']) {
      const type = schema.getType(input) as GraphQLInputObjectType;
      expect(type.getFields().attachmentPassword).toBeDefined();
    }
  });
});

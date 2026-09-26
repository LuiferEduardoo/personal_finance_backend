import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecretBox } from '../common/crypto/secret-box';
import { MailConnection } from './entities/mail-connection.entity';
import { MailInvoice } from './entities/mail-invoice.entity';
import { MailMessage } from './entities/mail-message.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailClientService } from './gmail/gmail-client.service';
import { GmailController } from './gmail/gmail.controller';
import {
  MAIL_SECRET_BOX,
  MailConnectionsService,
} from './mail-connections.service';
import { MailConnectionsResolver } from './mail-connections.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MailConnection,
      MailSender,
      MailMessage,
      MailInvoice,
    ]),
  ],
  providers: [
    // caja con SU clave: una fuga de la del correo no abre las de trading
    {
      provide: MAIL_SECRET_BOX,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new SecretBox(configService, {
          keyEnv: 'MAIL_ENCRYPTION_KEY',
          label: 'las conexiones de correo',
        }),
    },
    GmailClientService,
    MailConnectionsService,
    MailConnectionsResolver,
  ],
  controllers: [GmailController],
})
export class MailModule {}

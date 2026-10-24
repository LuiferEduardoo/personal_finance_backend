import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticlesModule } from '../articles/articles.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { TransactionsModule } from '../transactions/transactions.module';
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
import { MailCron } from './mail.cron';
import { MailIngestionService } from './mail-ingestion.service';
import { MailMessagesResolver } from './mail-messages.resolver';
import { MailSendersResolver } from './mail-senders.resolver';
import { MailSendersService } from './mail-senders.service';
import { MailSyncService } from './mail-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MailConnection,
      MailSender,
      MailMessage,
      MailInvoice,
    ]),
    ArticlesModule,
    CategoriesModule,
    CategorizationModule,
    PaymentMethodsModule,
    TransactionsModule,
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
    MailSendersService,
    MailSendersResolver,
    MailIngestionService,
    MailMessagesResolver,
    MailSyncService,
    MailCron,
  ],
  controllers: [GmailController],
})
export class MailModule {}

import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { InvestmentAccount } from '../../investments/entities/investment-account.entity';
import { PaymentMethod } from '../../payment-methods/entities/payment-method.entity';
import { User } from '../../users/entities/user.entity';
import { MailConnection } from './mail-connection.entity';

export enum MailBackfillStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

registerEnumType(MailBackfillStatus, {
  name: 'MailBackfillStatus',
  description: 'Estado de la lectura de correos antiguos de un remitente',
});

export enum MailSenderKind {
  INVOICE = 'invoice',
  XTB_ORDER_CONFIRMATION = 'xtb_order_confirmation',
}

registerEnumType(MailSenderKind, {
  name: 'MailSenderKind',
  description:
    'Qué manda el remitente: facturas electrónicas o confirmaciones de órdenes de XTB',
});

// Remitente cuyos correos se leen. Solo los correos de direcciones
// configuradas aquí se procesan: el resto del buzón ni se descarga.
//
// La contraseña de los adjuntos va cifrada con SecretBox (MAIL_ENCRYPTION_KEY)
// y sus columnas NO llevan @Field: GraphQL solo ve hasAttachmentPassword, que
// resuelve MailSendersResolver.
@ObjectType()
@Entity('mail_senders')
@Unique('mail_senders_email_unique', ['connectionId', 'emailAddress'])
export class MailSender {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_mail_senders',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_mail_senders_user',
  })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => MailConnection, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'connection_id',
    foreignKeyConstraintName: 'FK_mail_senders_connection',
  })
  connection: MailConnection;

  @Field(() => ID)
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @Field(() => MailSenderKind)
  @Column({
    type: 'enum',
    enum: MailSenderKind,
    enumName: 'mail_sender_kind',
    default: MailSenderKind.INVOICE,
  })
  kind: MailSenderKind;

  @Field({ description: 'Dirección del remitente, en minúsculas' })
  @Column({ name: 'email_address', type: 'text' })
  emailAddress: string;

  @Field({ description: 'Nombre del comercio con el que se registra el gasto' })
  @Column({ name: 'merchant_name', type: 'text' })
  merchantName: string;

  // cuenta de la que sale el dinero por defecto
  @Field(() => PaymentMethod, { name: 'defaultAccount', nullable: true })
  @ManyToOne(() => PaymentMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'default_account_id',
    foreignKeyConstraintName: 'FK_mail_senders_account',
  })
  defaultAccount: PaymentMethod | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'default_account_id', type: 'uuid', nullable: true })
  defaultAccountId: string | null;

  @Field(() => Category, { nullable: true })
  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'default_category_id',
    foreignKeyConstraintName: 'FK_mail_senders_category',
  })
  defaultCategory: Category | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'default_category_id', type: 'uuid', nullable: true })
  defaultCategoryId: string | null;

  // cuenta de inversión donde caen las operaciones de una confirmación de XTB
  @Field(() => InvestmentAccount, { nullable: true })
  @ManyToOne(() => InvestmentAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'investment_account_id',
    foreignKeyConstraintName: 'FK_mail_senders_investment_account',
  })
  investmentAccount: InvestmentAccount | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'investment_account_id', type: 'uuid', nullable: true })
  investmentAccountId: string | null;

  // --- contraseña de los adjuntos cifrada: sin @Field, nunca sale por la API ---

  @Column({
    name: 'attachment_password_ciphertext',
    type: 'bytea',
    nullable: true,
  })
  attachmentPasswordCiphertext: Buffer | null;

  @Column({ name: 'attachment_password_iv', type: 'bytea', nullable: true })
  attachmentPasswordIv: Buffer | null;

  @Column({ name: 'attachment_password_tag', type: 'bytea', nullable: true })
  attachmentPasswordTag: Buffer | null;

  @Column({
    name: 'attachment_password_key_version',
    type: 'smallint',
    default: 1,
  })
  attachmentPasswordKeyVersion: number;

  @Field()
  @Column({ default: true })
  active: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Desde qué fecha (YYYY-MM-DD) se leen los correos antiguos',
  })
  @Column({ name: 'backfill_from', type: 'date', nullable: true })
  backfillFrom: string | null;

  @Field(() => MailBackfillStatus)
  @Column({
    name: 'backfill_status',
    type: 'enum',
    enum: MailBackfillStatus,
    enumName: 'mail_backfill_status',
    default: MailBackfillStatus.IDLE,
  })
  backfillStatus: MailBackfillStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'backfill_error', type: 'text', nullable: true })
  backfillError: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
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
import { User } from '../../users/entities/user.entity';

export enum MailProvider {
  GMAIL = 'gmail',
}

export enum MailConnectionStatus {
  ACTIVE = 'active',
  ERROR = 'error',
  NEEDS_REAUTH = 'needs_reauth',
  DISABLED = 'disabled',
}

registerEnumType(MailProvider, { name: 'MailProvider' });
registerEnumType(MailConnectionStatus, {
  name: 'MailConnectionStatus',
  description: 'Estado de una conexión con un buzón de correo',
});

// Buzón conectado del que se leen las facturas electrónicas.
//
// El refresh token de Google va cifrado con SecretBox (MAIL_ENCRYPTION_KEY) y
// sus columnas NO llevan @Field: GraphQL nunca puede leerlo.
@ObjectType()
@Entity('mail_connections')
@Unique('mail_connections_email_unique', ['userId', 'emailAddress'])
export class MailConnection {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_mail_connections',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_mail_connections_user',
  })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => MailProvider)
  @Column({
    type: 'enum',
    enum: MailProvider,
    enumName: 'mail_provider',
    default: MailProvider.GMAIL,
  })
  provider: MailProvider;

  @Field()
  @Column({ name: 'email_address', type: 'text' })
  emailAddress: string;

  // --- refresh token cifrado: sin @Field, nunca sale por la API ---

  @Column({ name: 'token_ciphertext', type: 'bytea', nullable: true })
  tokenCiphertext: Buffer | null;

  @Column({ name: 'token_iv', type: 'bytea', nullable: true })
  tokenIv: Buffer | null;

  @Column({ name: 'token_tag', type: 'bytea', nullable: true })
  tokenTag: Buffer | null;

  @Field(() => Int, { description: 'Versión de clave con la que se cifró' })
  @Column({ name: 'token_key_version', type: 'smallint', default: 1 })
  tokenKeyVersion: number;

  @Field(() => MailConnectionStatus)
  @Column({
    type: 'enum',
    enum: MailConnectionStatus,
    enumName: 'mail_connection_status',
    default: MailConnectionStatus.ACTIVE,
  })
  status: MailConnectionStatus;

  // Punto del historial de Gmail hasta el que ya se procesó. Es un entero de
  // 64 bits: se guarda como texto para no perder precisión en JS.
  @Column({ name: 'history_id', type: 'text', nullable: true })
  historyId: string | null;

  @Field(() => Date, {
    nullable: true,
    description: 'Cuándo caduca la suscripción push de Gmail (dura 7 días)',
  })
  @Column({ name: 'watch_expires_at', type: 'timestamptz', nullable: true })
  watchExpiresAt: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field({ description: 'Si la conexión tiene un token guardado' })
  get hasToken(): boolean {
    return this.tokenCiphertext !== null;
  }
}

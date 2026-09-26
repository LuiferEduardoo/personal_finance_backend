import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Expense } from '../../transactions/entities/expense.entity';
import { MailConnection } from './mail-connection.entity';
import { MailSender } from './mail-sender.entity';

export enum MailMessageStatus {
  PROCESSING = 'processing',
  REGISTERED = 'registered',
  DUPLICATE = 'duplicate',
  NO_INVOICE = 'no_invoice',
  FAILED = 'failed',
}

registerEnumType(MailMessageStatus, {
  name: 'MailMessageStatus',
  description: 'Resultado de procesar un correo',
});

// Bitácora de correos procesados y, a la vez, el CERROJO de idempotencia: el
// push, la lectura de antiguos y el job de respaldo pueden ver el mismo
// correo; solo el que consigue insertar la fila lo procesa.
@ObjectType()
@Entity('mail_messages')
@Unique('mail_messages_gmail_unique', ['connectionId', 'gmailMessageId'])
@Index('idx_mail_messages_user_status', ['userId', 'status'])
export class MailMessage {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_mail_messages',
  })
  id: string;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => MailConnection, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'connection_id',
    foreignKeyConstraintName: 'FK_mail_messages_connection',
  })
  connection: MailConnection;

  @Field(() => ID)
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @Field()
  @Column({ name: 'gmail_message_id', type: 'text' })
  gmailMessageId: string;

  @ManyToOne(() => MailSender, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sender_id',
    foreignKeyConstraintName: 'FK_mail_messages_sender',
  })
  sender: MailSender | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  subject: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Field(() => MailMessageStatus)
  @Column({
    type: 'enum',
    enum: MailMessageStatus,
    enumName: 'mail_message_status',
    default: MailMessageStatus.PROCESSING,
  })
  status: MailMessageStatus;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'expense_id',
    foreignKeyConstraintName: 'FK_mail_messages_expense',
  })
  expense: Expense | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

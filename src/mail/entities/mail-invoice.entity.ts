import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Expense } from '../../transactions/entities/expense.entity';
import { User } from '../../users/entities/user.entity';
import { MailMessage } from './mail-message.entity';

// Factura electrónica ya registrada, identificada por su CUFE.
//
// El índice único (user_id, cufe) es lo que impide registrar dos veces la
// misma factura: llega en dos correos, se reenvía, o la lectura de antiguos
// la vuelve a encontrar. Si el usuario borra el gasto la fila se queda (con
// expense_id a NULL), así que tampoco se vuelve a crear sola.
@ObjectType()
@Entity('mail_invoices')
@Unique('mail_invoices_cufe_unique', ['userId', 'cufe'])
export class MailInvoice {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_mail_invoices',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_mail_invoices_user',
  })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field()
  @Column({ type: 'text' })
  cufe: string;

  @Field()
  @Column({ name: 'invoice_number', type: 'text' })
  invoiceNumber: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'issuer_nit', type: 'text', nullable: true })
  issuerNit: string | null;

  @Field()
  @Column({ name: 'issuer_name', type: 'text' })
  issuerName: string;

  @Field()
  @Column({ name: 'issue_date', type: 'date' })
  issueDate: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  total: number;

  @Field()
  @Column({ type: 'char', length: 3 })
  currency: string;

  @ManyToOne(() => MailMessage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mail_message_id',
    foreignKeyConstraintName: 'FK_mail_invoices_message',
  })
  mailMessage: MailMessage | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'mail_message_id', type: 'uuid', nullable: true })
  mailMessageId: string | null;

  @ManyToOne(() => Expense, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'expense_id',
    foreignKeyConstraintName: 'FK_mail_invoices_expense',
  })
  expense: Expense | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'expense_id', type: 'uuid', nullable: true })
  expenseId: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

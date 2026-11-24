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
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum NotificationType {
  BUDGET_NEAR = 'budget_near',
  BUDGET_EXCEEDED = 'budget_exceeded',
  LOAN_INSTALLMENT_DUE = 'loan_installment_due',
  LOAN_INSTALLMENT_OVERDUE = 'loan_installment_overdue',
  MAIL_MESSAGE_FAILED = 'mail_message_failed',
  RECURRING_EXPENSES_GENERATED = 'recurring_expenses_generated',
}

registerEnumType(NotificationType, {
  name: 'NotificationType',
  description: 'Origen de una notificación dentro de la app',
});

// Notificación dentro de la app. `dedupe_key` (único por usuario) es el
// cerrojo: los productores insertan con ON CONFLICT DO NOTHING, así que
// volver a evaluar el mismo evento (cron, reintentos) no la duplica.
@ObjectType({ description: 'Notificación dentro de la app' })
@Entity('notifications')
@Unique('notifications_dedupe_unique', ['userId', 'dedupeKey'])
@Index('idx_notifications_user_read', ['userId', 'readAt'])
export class Notification {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_notifications',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_notifications_user',
  })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => NotificationType)
  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type: NotificationType;

  @Field()
  @Column({ type: 'text' })
  title: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  @Field(() => String, {
    nullable: true,
    description: 'Ruta del frontend a la que lleva (p. ej. /presupuestos)',
  })
  @Column({ type: 'text', nullable: true })
  link: string | null;

  // identifica el evento: la misma clave no se notifica dos veces
  @Column({ name: 'dedupe_key', type: 'text' })
  dedupeKey: string;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

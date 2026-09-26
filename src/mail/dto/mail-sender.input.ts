import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { MailMessageStatus } from '../entities/mail-message.entity';

@InputType()
export class CreateMailSenderInput {
  @Field(() => ID, { description: 'Buzón del que se leen sus correos' })
  connectionId: string;

  @Field({ description: 'Dirección que envía las facturas' })
  emailAddress: string;

  @Field({ description: 'Nombre del comercio con el que se registra el gasto' })
  merchantName: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta de la que sale el dinero por defecto',
  })
  defaultAccountId?: string;

  @Field(() => ID, { nullable: true })
  defaultCategoryId?: string;

  @Field({
    nullable: true,
    description:
      'Si se indica (YYYY-MM-DD), al crear el remitente se leen sus correos desde esa fecha',
  })
  backfillFrom?: string;
}

// El buzón NO se puede cambiar: la bitácora de correos procesados es suya.
@InputType()
export class UpdateMailSenderInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  emailAddress?: string;

  @Field({ nullable: true })
  merchantName?: string;

  @Field(() => ID, { nullable: true })
  defaultAccountId?: string;

  @Field(() => ID, { nullable: true })
  defaultCategoryId?: string;

  @Field({ nullable: true })
  active?: boolean;
}

@InputType()
export class MailMessagesFilterInput {
  @Field(() => MailMessageStatus, { nullable: true })
  status?: MailMessageStatus;

  @Field(() => ID, { nullable: true })
  senderId?: string;

  @Field(() => Int, { nullable: true, defaultValue: 50 })
  limit?: number;
}

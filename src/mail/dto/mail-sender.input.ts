import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { MailMessageStatus } from '../entities/mail-message.entity';
import { MailSenderKind } from '../entities/mail-sender.entity';

@InputType()
export class CreateMailSenderInput {
  @Field(() => ID, { description: 'Buzón del que se leen sus correos' })
  connectionId: string;

  @Field(() => MailSenderKind, {
    nullable: true,
    defaultValue: MailSenderKind.INVOICE,
    description: 'Qué manda el remitente. Por defecto, facturas electrónicas',
  })
  kind?: MailSenderKind;

  @Field({ description: 'Dirección que envía los correos' })
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

  @Field(() => ID, {
    nullable: true,
    description:
      'Cuenta de inversión donde se registran las confirmaciones de órdenes',
  })
  investmentAccountId?: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Contraseña de los PDF adjuntos. Se guarda cifrada y nunca se devuelve',
  })
  attachmentPassword?: string;

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

  @Field(() => MailSenderKind, { nullable: true })
  kind?: MailSenderKind;

  @Field({ nullable: true })
  emailAddress?: string;

  @Field({ nullable: true })
  merchantName?: string;

  @Field(() => ID, { nullable: true })
  defaultAccountId?: string;

  @Field(() => ID, { nullable: true })
  defaultCategoryId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'null quita la cuenta de inversión',
  })
  investmentAccountId?: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Reemplaza la contraseña de los PDF adjuntos; null la borra. Nunca se devuelve',
  })
  attachmentPassword?: string | null;

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

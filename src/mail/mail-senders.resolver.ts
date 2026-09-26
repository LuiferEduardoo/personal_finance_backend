import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlUserOnlyGuard } from '../auth/guards/gql-user-only.guard';
import { Principal } from '../auth/principal';
import {
  CreateMailSenderInput,
  UpdateMailSenderInput,
} from './dto/mail-sender.input';
import { MailSender } from './entities/mail-sender.entity';
import { MailSendersService } from './mail-senders.service';
import { MailSyncService } from './mail-sync.service';

// Mismo blindaje que mail-connections.resolver.ts: solo JWT de usuario.
@Resolver(() => MailSender)
@UseGuards(GqlUserOnlyGuard)
export class MailSendersResolver {
  constructor(
    private readonly sendersService: MailSendersService,
    private readonly syncService: MailSyncService,
  ) {}

  @Query(() => [MailSender], {
    description: 'Remitentes cuyas facturas electrónicas se leen del correo',
  })
  mailSenders(
    @CurrentUser() user: Principal,
    @Args('connectionId', { type: () => ID, nullable: true })
    connectionId?: string,
  ): Promise<MailSender[]> {
    return this.sendersService.findAll(user.sub, connectionId);
  }

  @Mutation(() => MailSender, {
    description:
      'Configura un remitente. Sus facturas se registran solas como gasto en la cuenta ' +
      'por defecto. Con backfillFrom se leen además sus correos desde esa fecha.',
  })
  async createMailSender(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateMailSenderInput,
  ): Promise<MailSender> {
    const sender = await this.sendersService.create(user.sub, input);
    if (input.backfillFrom) {
      return this.syncService.startBackfill(user.sub, sender.id);
    }
    return sender;
  }

  @Mutation(() => MailSender)
  updateMailSender(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateMailSenderInput,
  ): Promise<MailSender> {
    return this.sendersService.update(user.sub, input);
  }

  @Mutation(() => Boolean, {
    description:
      'Deja de leer este remitente. Los gastos ya registrados se conservan.',
  })
  deleteMailSender(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.sendersService.remove(id, user.sub);
  }

  @Mutation(() => MailSender, {
    description:
      'Lee los correos antiguos del remitente (desde `since`, o desde su backfillFrom, o todos). ' +
      'Corre en segundo plano: el avance se ve en backfillStatus y en mailMessages. ' +
      'Es idempotente: las facturas ya registradas no se duplican.',
  })
  backfillMailSender(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
    @Args('since', { nullable: true }) since?: string,
  ): Promise<MailSender> {
    return this.syncService.startBackfill(user.sub, id, since);
  }
}

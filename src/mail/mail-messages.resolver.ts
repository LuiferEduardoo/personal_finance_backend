import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlUserOnlyGuard } from '../auth/guards/gql-user-only.guard';
import { Principal } from '../auth/principal';
import { MailMessagesFilterInput } from './dto/mail-sender.input';
import { MailMessage } from './entities/mail-message.entity';
import { MailConnectionsService } from './mail-connections.service';
import { MailIngestionService } from './mail-ingestion.service';
import { MailSyncService } from './mail-sync.service';

@Resolver(() => MailMessage)
@UseGuards(GqlUserOnlyGuard)
export class MailMessagesResolver {
  constructor(
    private readonly ingestionService: MailIngestionService,
    private readonly connectionsService: MailConnectionsService,
    private readonly syncService: MailSyncService,
  ) {}

  @Query(() => [MailMessage], {
    description:
      'Bitácora de correos de remitentes configurados: registrados, duplicados, sin factura o fallidos',
  })
  mailMessages(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true }) filter?: MailMessagesFilterInput,
  ): Promise<MailMessage[]> {
    return this.ingestionService.findMessages(user.sub, filter);
  }

  @Mutation(() => MailMessage, {
    description:
      'Reprocesa un correo fallido (p. ej. tras liberar cupo en la tarjeta)',
  })
  retryMailMessage(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<MailMessage> {
    return this.ingestionService.retry(id, user.sub);
  }

  @Mutation(() => Boolean, {
    description:
      'Lee ya los correos nuevos del buzón, sin esperar al push ni al job horario',
  })
  async syncMailConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    const connection = await this.connectionsService.findOne(id, user.sub);
    await this.syncService.syncHistory(connection);
    return true;
  }
}

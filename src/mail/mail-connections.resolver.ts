import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlUserOnlyGuard } from '../auth/guards/gql-user-only.guard';
import { Principal } from '../auth/principal';
import { MailConnection } from './entities/mail-connection.entity';
import { MailConnectionsService } from './mail-connections.service';

// Cerrado a las API keys igual que broker-connections.resolver.ts: aquí se
// da acceso de lectura al correo del usuario. GqlUserOnlyGuard rechaza las API
// keys y ninguna operación declara @Scopes.
@Resolver(() => MailConnection)
@UseGuards(GqlUserOnlyGuard)
export class MailConnectionsResolver {
  constructor(private readonly connectionsService: MailConnectionsService) {}

  @Query(() => [MailConnection], {
    description:
      'Buzones conectados. El token NUNCA se devuelve: solo hasToken.',
  })
  mailConnections(@CurrentUser() user: Principal): Promise<MailConnection[]> {
    return this.connectionsService.findAll(user.sub);
  }

  @Query(() => String, {
    description:
      'URL de consentimiento de Google para conectar Gmail (solo lectura). ' +
      'Al aceptar, Google redirige a /mail/google/callback.',
  })
  gmailAuthUrl(@CurrentUser() user: Principal): string {
    return this.connectionsService.authUrl(user.sub);
  }

  @Mutation(() => Boolean, {
    description:
      'Desconecta el buzón: revoca el acceso en Google y borra remitentes y bitácora. ' +
      'Los gastos ya registrados se conservan.',
  })
  disconnectMailConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.connectionsService.disconnect(id, user.sub);
  }
}

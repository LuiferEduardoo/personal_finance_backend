import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlUserOnlyGuard } from '../auth/guards/gql-user-only.guard';
import { Principal } from '../auth/principal';
import {
  BrokerSyncReport,
  CreateBrokerConnectionInput,
  UpdateBrokerConnectionInput,
} from './dto/broker-connection.input';
import { BrokerConnection } from './entities/broker-connection.entity';
import { BrokerConnectionsService } from './broker-connections.service';
import { InvestmentSyncService } from './investment-sync.service';

// ---------------------------------------------------------------------------
// TODO este resolver está cerrado por partida doble a las API keys:
//
//  1. GqlUserOnlyGuard (allowApiKey = false) rechaza cualquier principal que
//     no sea un usuario con JWT.
//  2. NINGUNA operación lleva @Scopes, y BaseAuthGuard cierra por defecto a
//     las API keys las operaciones sin scope declarado.
//
// Es el mismo blindaje que usa api-keys.resolver.ts contra la escalada de
// privilegios, y aquí importa todavía más: por aquí entran contraseñas reales
// de trading.
// ---------------------------------------------------------------------------
@Resolver(() => BrokerConnection)
@UseGuards(GqlUserOnlyGuard)
export class BrokerConnectionsResolver {
  constructor(
    private readonly connectionsService: BrokerConnectionsService,
    private readonly syncService: InvestmentSyncService,
  ) {}

  @Query(() => [BrokerConnection], {
    description:
      'Conexiones con brókers. Las credenciales NUNCA se devuelven: solo hasCredentials.',
  })
  brokerConnections(
    @CurrentUser() user: Principal,
  ): Promise<BrokerConnection[]> {
    return this.connectionsService.findAll(user.sub);
  }

  @Query(() => BrokerConnection)
  brokerConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BrokerConnection> {
    return this.connectionsService.findOne(id, user.sub);
  }

  @Mutation(() => BrokerConnection, {
    description:
      'Guarda una conexión. Las credenciales se cifran con AES-256-GCM y no vuelven a salir.',
  })
  createBrokerConnection(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateBrokerConnectionInput,
  ): Promise<BrokerConnection> {
    return this.connectionsService.create(user.sub, input);
  }

  @Mutation(() => BrokerConnection)
  updateBrokerConnection(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateBrokerConnectionInput,
  ): Promise<BrokerConnection> {
    return this.connectionsService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  deleteBrokerConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.connectionsService.remove(id, user.sub);
  }

  @Mutation(() => BrokerConnection, {
    description:
      'Comprueba las credenciales contra el bróker y actualiza el estado de la conexión',
  })
  verifyBrokerConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BrokerConnection> {
    return this.connectionsService.verify(id, user.sub);
  }

  @Mutation(() => BrokerSyncReport, {
    description:
      'Trae las operaciones del bróker. Es idempotente: resincronizar un periodo ya traído no duplica nada.',
  })
  syncBrokerConnection(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BrokerSyncReport> {
    return this.syncService.sync(user.sub, id);
  }

  @Mutation(() => [BrokerSyncReport], {
    description: 'Sincroniza todas las conexiones activas',
  })
  syncAllBrokerConnections(
    @CurrentUser() user: Principal,
  ): Promise<BrokerSyncReport[]> {
    return this.syncService.syncAll(user.sub);
  }

  @Mutation(() => Int, {
    description:
      'Vuelve a cifrar las credenciales con la clave actual. Rotación sin cortar el servicio: ' +
      'pon la clave vieja en INVESTMENTS_ENCRYPTION_KEY_PREVIOUS y la nueva en INVESTMENTS_ENCRYPTION_KEY.',
  })
  rotateBrokerCredentials(@CurrentUser() user: Principal): Promise<number> {
    return this.connectionsService.rotate(user.sub);
  }
}

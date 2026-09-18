import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Mutation,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlUserOnlyGuard } from '../auth/guards/gql-user-only.guard';
import { Principal } from '../auth/principal';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyCreated } from './dto/api-key-created.type';
import { CreateApiKeyInput } from './dto/create-api-key.input';
import { UpdateApiKeyInput } from './dto/update-api-key.input';
import { ApiKey } from './entities/api-key.entity';

// Gestión de credenciales: siempre con el JWT del usuario. Una API key no
// puede administrarse a sí misma ni emitir otras.
@Resolver(() => ApiKey)
@UseGuards(GqlUserOnlyGuard)
export class ApiKeysResolver {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @ResolveField(() => Boolean, {
    description: 'Si la key sigue autenticando (ni revocada ni expirada)',
  })
  isActive(apiKey: ApiKey): boolean {
    if (apiKey.revokedAt) {
      return false;
    }
    return !apiKey.expiresAt || apiKey.expiresAt.getTime() > Date.now();
  }

  @Query(() => [ApiKey], { description: 'API keys del usuario' })
  apiKeys(@CurrentUser() user: Principal): Promise<ApiKey[]> {
    return this.apiKeysService.findAll(user.sub);
  }

  @Query(() => ApiKey)
  apiKey(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ApiKey> {
    return this.apiKeysService.findOne(user.sub, id);
  }

  @Mutation(() => ApiKeyCreated, {
    description:
      'Crea una API key. El token completo solo se devuelve en esta respuesta',
  })
  createApiKey(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateApiKeyInput,
  ): Promise<ApiKeyCreated> {
    return this.apiKeysService.create(user.sub, input);
  }

  @Mutation(() => ApiKey, { description: 'Cambia nombre, scopes o expiración' })
  updateApiKey(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateApiKeyInput,
  ): Promise<ApiKey> {
    return this.apiKeysService.update(user.sub, input);
  }

  @Mutation(() => ApiKey, {
    description: 'Revoca la key: deja de autenticar de inmediato',
  })
  revokeApiKey(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ApiKey> {
    return this.apiKeysService.revoke(user.sub, id);
  }

  @Mutation(() => Boolean, { description: 'Borra la key del registro' })
  removeApiKey(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.apiKeysService.remove(user.sub, id);
  }
}

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AuthenticatedRequest, BaseAuthGuard } from './base-auth.guard';

// Solo JWT de usuario. Para operaciones que gestionan credenciales: una API
// key no puede emitir, ampliar ni revocar API keys (escalada de privilegios).
@Injectable()
export class GqlUserOnlyGuard extends BaseAuthGuard {
  protected readonly allowApiKey = false;

  constructor(
    jwtService: JwtService,
    apiKeysService: ApiKeysService,
    reflector: Reflector,
  ) {
    super(jwtService, apiKeysService, reflector);
  }

  protected getRequest(context: ExecutionContext): AuthenticatedRequest {
    return GqlExecutionContext.create(context).getContext()
      .req as AuthenticatedRequest;
  }
}

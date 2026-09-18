import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AuthenticatedRequest, BaseAuthGuard } from './base-auth.guard';

// Igual que GqlAuthGuard pero para controllers REST: obtiene el request
// del contexto HTTP en vez del contexto GraphQL.
@Injectable()
export class JwtAuthGuard extends BaseAuthGuard {
  constructor(
    jwtService: JwtService,
    apiKeysService: ApiKeysService,
    reflector: Reflector,
  ) {
    super(jwtService, apiKeysService, reflector);
  }

  protected getRequest(context: ExecutionContext): AuthenticatedRequest {
    return context.switchToHttp().getRequest<AuthenticatedRequest>();
  }
}

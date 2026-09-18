import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { ApiScope } from '../../common/enums/api-scope.enum';
import { JwtPayload } from '../auth.service';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { Principal, PrincipalKind } from '../principal';

export interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: Principal;
}

const API_KEY_HEADER = 'x-api-key';
const API_KEY_TOKEN_PREFIX = 'pfk_';

/**
 * Autenticación común a GraphQL y REST. Acepta dos credenciales:
 *
 * - JWT de usuario (`Authorization: Bearer <jwt>`): acceso total a sus datos.
 * - API key (`X-API-Key: pfk_...` o el mismo header Authorization): acceso
 *   limitado a los scopes declarados con @Scopes en la operación.
 *
 * Las subclases solo aportan de dónde sacar el request.
 */
export abstract class BaseAuthGuard implements CanActivate {
  // las subclases que gestionan credenciales lo ponen en false: una API key
  // no puede crear ni modificar API keys
  protected readonly allowApiKey: boolean = true;

  constructor(
    protected readonly jwtService: JwtService,
    protected readonly apiKeysService: ApiKeysService,
    protected readonly reflector: Reflector,
  ) {}

  protected abstract getRequest(
    context: ExecutionContext,
  ): AuthenticatedRequest;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);
    const apiKeyToken = this.readApiKeyToken(request);

    if (apiKeyToken) {
      if (!this.allowApiKey) {
        throw new UnauthorizedException(
          'Esta operación requiere el token de un usuario, no una API key',
        );
      }
      const principal = await this.apiKeysService.verify(apiKeyToken);
      this.assertScopes(context, principal);
      request.user = principal;
      return true;
    }

    request.user = await this.verifyJwt(request);
    return true;
  }

  private readApiKeyToken(request: AuthenticatedRequest): string | undefined {
    const header = request.headers?.[API_KEY_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (fromHeader?.startsWith(API_KEY_TOKEN_PREFIX)) {
      return fromHeader;
    }
    // también se admite en Authorization, para clientes que solo mandan ese
    const [scheme, token] = this.readAuthorization(request);
    return scheme === 'Bearer' && token?.startsWith(API_KEY_TOKEN_PREFIX)
      ? token
      : undefined;
  }

  private async verifyJwt(request: AuthenticatedRequest): Promise<Principal> {
    const [scheme, token] = this.readAuthorization(request);
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return {
        ...payload,
        kind: PrincipalKind.USER,
        scopes: [ApiScope.ALL],
      };
    } catch {
      throw new UnauthorizedException('Token de acceso inválido o expirado');
    }
  }

  private readAuthorization(
    request: AuthenticatedRequest,
  ): [string | undefined, string | undefined] {
    const header = request.headers?.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const [scheme, token] = value?.split(' ') ?? [];
    return [scheme, token];
  }

  /**
   * Una operación sin @Scopes queda cerrada a las API keys: así lo nuevo no
   * se expone por olvido. El JWT de usuario nunca pasa por aquí.
   */
  private assertScopes(context: ExecutionContext, principal: Principal): void {
    const required = this.reflector.getAllAndOverride<ApiScope[] | undefined>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      throw new ForbiddenException(
        'Esta operación no está disponible para API keys',
      );
    }
    if (principal.scopes.includes(ApiScope.ALL)) {
      return;
    }
    const missing = required.filter(
      (scope) => !principal.scopes.includes(scope),
    );
    if (missing.length) {
      throw new ForbiddenException(
        `La API key no tiene los permisos requeridos: ${missing.join(', ')}`,
      );
    }
  }
}

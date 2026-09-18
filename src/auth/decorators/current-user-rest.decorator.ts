import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Principal } from '../principal';

// Igual que CurrentUser pero para controllers REST: lee el principal que
// JwtAuthGuard deja en el request HTTP.
export const CurrentUserRest = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    return context.switchToHttp().getRequest().user as Principal;
  },
);

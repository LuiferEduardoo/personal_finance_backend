import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth.service';

// Igual que CurrentUser pero para controllers REST: lee el usuario que
// JwtAuthGuard deja en el request HTTP.
export const CurrentUserRest = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    return context.switchToHttp().getRequest().user;
  },
);

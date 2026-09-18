import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Principal } from '../principal';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req.user as Principal;
  },
);

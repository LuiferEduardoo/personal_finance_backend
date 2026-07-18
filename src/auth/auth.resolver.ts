import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { User } from '../users/entities/user.entity';
import { AuthService, JwtPayload } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthPayload } from './dto/auth-payload';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { GqlAuthGuard } from './guards/gql-auth.guard';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload)
  register(@Args('input') input: RegisterInput): Promise<AuthPayload> {
    return this.authService.register(input);
  }

  @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput): Promise<AuthPayload> {
    return this.authService.login(input);
  }

  @Mutation(() => AuthPayload, {
    description: 'Rota el refresh token y emite un nuevo par de tokens',
  })
  refreshTokens(
    @Args('refreshToken') refreshToken: string,
  ): Promise<AuthPayload> {
    return this.authService.refreshTokens(refreshToken);
  }

  @Mutation(() => Boolean, {
    description: 'Revoca el refresh token (cierra la sesión)',
  })
  logout(@Args('refreshToken') refreshToken: string): Promise<boolean> {
    return this.authService.logout(refreshToken);
  }

  @Query(() => User, { description: 'Usuario autenticado (requiere Bearer)' })
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() payload: JwtPayload): Promise<User> {
    return this.authService.findUserById(payload.sub);
  }
}

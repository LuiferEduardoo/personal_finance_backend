import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { User } from '../users/entities/user.entity';
import { AuthService, JwtPayload } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthPayload } from './dto/auth-payload';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import {
  ChangePasswordInput,
  ResetPasswordInput,
  TwoFactorSetup,
} from './dto/security.input';
import { TwoFactorMethod } from './entities/authentication.entity';
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

  @Mutation(() => TwoFactorSetup)
  @UseGuards(GqlAuthGuard)
  beginTwoFactorSetup(
    @CurrentUser() user: JwtPayload,
    @Args('method', { type: () => TwoFactorMethod }) method: TwoFactorMethod,
  ): Promise<TwoFactorSetup> {
    return this.authService.beginTwoFactor(user.sub, method);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  confirmTwoFactorSetup(
    @CurrentUser() user: JwtPayload,
    @Args('method', { type: () => TwoFactorMethod }) method: TwoFactorMethod,
    @Args('code') code: string,
  ): Promise<boolean> {
    return this.authService.confirmTwoFactor(user.sub, method, code);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  disableTwoFactor(
    @CurrentUser() user: JwtPayload,
    @Args('code') code: string,
  ) {
    return this.authService.disableTwoFactor(user.sub, code);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: ChangePasswordInput,
  ) {
    return this.authService.changePassword(user.sub, input);
  }

  @Mutation(() => Boolean)
  requestPasswordReset(@Args('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Mutation(() => Boolean)
  resetPassword(@Args('input') input: ResetPasswordInput) {
    return this.authService.resetPassword(input);
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

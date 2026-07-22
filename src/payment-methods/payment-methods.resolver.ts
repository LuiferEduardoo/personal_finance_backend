import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CreateAccountInput } from './dto/create-account.input';
import { UpdateAccountInput } from './dto/update-account.input';
import { PaymentMethod } from './entities/payment-method.entity';
import { PaymentMethodsService } from './payment-methods.service';

@Resolver(() => PaymentMethod)
@UseGuards(GqlAuthGuard)
export class PaymentMethodsResolver {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Query(() => [PaymentMethod], {
    description: 'Cuentas del usuario (efectivo, banco, tarjeta, etc.)',
  })
  accounts(
    @CurrentUser() user: JwtPayload,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<PaymentMethod[]> {
    return this.paymentMethodsService.findAll(user.sub, includeInactive);
  }

  @Query(() => PaymentMethod)
  account(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<PaymentMethod> {
    return this.paymentMethodsService.findOne(id, user.sub);
  }

  @Mutation(() => PaymentMethod)
  createAccount(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: CreateAccountInput,
  ): Promise<PaymentMethod> {
    return this.paymentMethodsService.create(user.sub, input);
  }

  @Mutation(() => PaymentMethod)
  updateAccount(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateAccountInput,
  ): Promise<PaymentMethod> {
    return this.paymentMethodsService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  removeAccount(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.paymentMethodsService.remove(id, user.sub);
  }
}

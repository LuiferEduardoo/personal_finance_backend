import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CreateAccountInput } from './dto/create-account.input';
import { TransferInput } from './dto/transfer.input';
import { UpdateAccountInput } from './dto/update-account.input';
import { AccountTransfer } from './entities/account-transfer.entity';
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

  @Query(() => [AccountTransfer], {
    description: 'Transferencias entre cuentas (opcional por cuenta)',
  })
  accountTransfers(
    @CurrentUser() user: JwtPayload,
    @Args('accountId', { type: () => ID, nullable: true }) accountId?: string,
  ): Promise<AccountTransfer[]> {
    return this.paymentMethodsService.findTransfers(user.sub, accountId);
  }

  @Mutation(() => AccountTransfer, {
    description:
      'Transfiere saldo entre cuentas. Transferir a una cuenta de crédito paga la tarjeta.',
  })
  transferBetweenAccounts(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: TransferInput,
  ): Promise<AccountTransfer> {
    return this.paymentMethodsService.transfer(user.sub, input);
  }

  @Mutation(() => PaymentMethod, {
    description: 'Recalcula el saldo de la cuenta desde sus movimientos',
  })
  recalculateAccountBalance(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<PaymentMethod> {
    return this.paymentMethodsService.recalculateBalance(id, user.sub);
  }
}

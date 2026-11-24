import { UseGuards } from '@nestjs/common';
import {
  Args,
  Float,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import {
  CreateLoanInput,
  PayLoanInstallmentInput,
  PrepayLoanInput,
  UpdateLoanInput,
} from './dto/loan.inputs';
import { LoanCharge } from './entities/loan-charge.entity';
import { LoanInstallment } from './entities/loan-installment.entity';
import { LoanPrepayment } from './entities/loan-prepayment.entity';
import { Loan } from './entities/loan.entity';
import { LoansService } from './loans.service';

@Resolver(() => Loan)
@UseGuards(GqlAuthGuard)
export class LoansResolver {
  constructor(private readonly loansService: LoansService) {}

  @Query(() => [Loan], { description: 'Créditos del usuario' })
  @Scopes(ApiScope.LOANS_READ)
  loans(@CurrentUser() user: Principal): Promise<Loan[]> {
    return this.loansService.findAll(user.sub);
  }

  @Query(() => Loan)
  @Scopes(ApiScope.LOANS_READ)
  loan(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Loan> {
    return this.loansService.findOne(id, user.sub);
  }

  @ResolveField(() => [LoanInstallment], {
    description: 'Tabla de cuotas, en orden',
  })
  @Scopes(ApiScope.LOANS_READ)
  installments(@Parent() loan: Loan): Promise<LoanInstallment[]> {
    return this.loansService.findInstallments(loan.id);
  }

  @ResolveField(() => [LoanCharge])
  @Scopes(ApiScope.LOANS_READ)
  charges(@Parent() loan: Loan): Promise<LoanCharge[]> {
    return this.loansService.findCharges(loan.id);
  }

  @ResolveField(() => [LoanPrepayment])
  @Scopes(ApiScope.LOANS_READ)
  prepayments(@Parent() loan: Loan): Promise<LoanPrepayment[]> {
    return this.loansService.findPrepayments(loan.id);
  }

  @ResolveField(() => Float, {
    description: 'Saldo de capital: capital de las cuotas pendientes',
  })
  @Scopes(ApiScope.LOANS_READ)
  async outstandingPrincipal(@Parent() loan: Loan): Promise<number> {
    return (await this.loansService.summarize(loan.id)).outstandingPrincipal;
  }

  @ResolveField(() => Float, {
    description: 'Intereses de la tabla actual (pagados + pendientes)',
  })
  @Scopes(ApiScope.LOANS_READ)
  async totalInterest(@Parent() loan: Loan): Promise<number> {
    return (await this.loansService.summarize(loan.id)).totalInterest;
  }

  @ResolveField(() => Float, {
    description:
      'Seguros y comisiones de la tabla actual (pagados + pendientes)',
  })
  @Scopes(ApiScope.LOANS_READ)
  async totalCharges(@Parent() loan: Loan): Promise<number> {
    return (await this.loansService.summarize(loan.id)).totalCharges;
  }

  @ResolveField(() => LoanInstallment, {
    nullable: true,
    description: 'Cuota pendiente más antigua (la única que se puede pagar)',
  })
  @Scopes(ApiScope.LOANS_READ)
  async nextInstallment(@Parent() loan: Loan): Promise<LoanInstallment | null> {
    return (await this.loansService.summarize(loan.id)).nextInstallment;
  }

  @Mutation(() => Loan, {
    description:
      'Crea un crédito con su tabla de cuotas; el desembolso suma al saldo de la cuenta (no es un ingreso)',
  })
  @Scopes(ApiScope.LOANS_WRITE)
  createLoan(
    @CurrentUser() user: Principal,
    @Args('input') input: CreateLoanInput,
  ): Promise<Loan> {
    return this.loansService.create(user.sub, input);
  }

  @Mutation(() => Loan, {
    description:
      'Edita nombre, entidad, categoría y cuenta de pagos; las condiciones financieras son inmutables',
  })
  @Scopes(ApiScope.LOANS_WRITE)
  updateLoan(
    @CurrentUser() user: Principal,
    @Args('input') input: UpdateLoanInput,
  ): Promise<Loan> {
    return this.loansService.update(user.sub, input);
  }

  @Mutation(() => Boolean, {
    description:
      'Borra un crédito sin cuotas pagadas ni abonos y retira el desembolso de la cuenta',
  })
  @Scopes(ApiScope.LOANS_WRITE)
  removeLoan(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.loansService.remove(id, user.sub);
  }

  @Mutation(() => LoanInstallment, {
    description:
      'Paga la cuota pendiente más antigua registrando un gasto "<crédito> (n/N)"',
  })
  @Scopes(ApiScope.LOANS_WRITE)
  payLoanInstallment(
    @CurrentUser() user: Principal,
    @Args('input') input: PayLoanInstallmentInput,
  ): Promise<LoanInstallment> {
    return this.loansService.payInstallment(user.sub, input);
  }

  @Mutation(() => Loan, {
    description:
      'Abono extraordinario a capital: registra un gasto y regenera las cuotas pendientes',
  })
  @Scopes(ApiScope.LOANS_WRITE)
  prepayLoan(
    @CurrentUser() user: Principal,
    @Args('input') input: PrepayLoanInput,
  ): Promise<Loan> {
    return this.loansService.prepay(user.sub, input);
  }
}

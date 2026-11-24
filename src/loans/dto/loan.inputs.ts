import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { LoanChargeKind, LoanChargeMode } from '../entities/loan-charge.entity';
import { LoanPrepaymentMode } from '../entities/loan-prepayment.entity';
import { LoanRateType } from '../entities/loan.entity';

@InputType()
export class LoanChargeInput {
  @Field()
  name: string;

  @Field(() => LoanChargeKind)
  kind: LoanChargeKind;

  @Field(() => LoanChargeMode)
  mode: LoanChargeMode;

  @Field(() => Float, {
    description:
      'FIXED: dinero por cuota; PERCENT_OF_BALANCE: fracción mensual sobre el saldo (0.001 = 0.1%)',
  })
  value: number;
}

@InputType()
export class CreateLoanInput {
  @Field()
  name: string;

  @Field({ nullable: true, description: 'Entidad que presta' })
  lender?: string;

  @Field(() => Float, { description: 'Capital desembolsado, mayor que 0' })
  principalAmount: number;

  @Field({ nullable: true, defaultValue: 'COP' })
  currency?: string;

  @Field(() => LoanRateType)
  rateType: LoanRateType;

  @Field(() => Float, {
    description:
      'Tasa en decimal (0.24 = 24%): EA entre 0 y 10, mensual entre 0 y 1',
  })
  rate: number;

  @Field(() => Int, { description: 'Número de cuotas mensuales (1 a 600)' })
  installmentCount: number;

  @Field({ description: 'Fecha de desembolso (YYYY-MM-DD)' })
  disbursedOn: string;

  @Field({
    nullable: true,
    description:
      'Vencimiento de la primera cuota (YYYY-MM-DD); por defecto, un mes después del desembolso',
  })
  firstDueDate?: string;

  @Field(() => ID, {
    nullable: true,
    description:
      'Cuenta a la que entra el desembolso (suma al saldo; no es un ingreso)',
  })
  disbursementAccountId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta por defecto de la que salen los pagos',
  })
  paymentAccountId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Categoría de gasto de los pagos',
  })
  categoryId?: string;

  @Field(() => [LoanChargeInput], {
    nullable: true,
    description: 'Seguros y comisiones que se suman a cada cuota',
  })
  charges?: LoanChargeInput[];
}

// las condiciones financieras (capital, tasa, plazo, fechas, cargos y cuenta
// de desembolso) no se editan: cambiarían la tabla ya pagada en parte
@InputType({
  description:
    'Solo datos descriptivos; las condiciones financieras son inmutables',
})
export class UpdateLoanInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  lender?: string | null;

  @Field(() => ID, { nullable: true })
  categoryId?: string | null;

  @Field(() => ID, { nullable: true })
  paymentAccountId?: string | null;
}

@InputType()
export class PayLoanInstallmentInput {
  @Field(() => ID)
  installmentId: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Cuenta de la que sale el pago; por defecto la del crédito',
  })
  accountId?: string;

  @Field({
    nullable: true,
    description: 'Fecha del pago (YYYY-MM-DD); por defecto hoy',
  })
  paidOn?: string;
}

@InputType()
export class PrepayLoanInput {
  @Field(() => ID)
  loanId: string;

  @Field(() => Float, {
    description:
      'Abono a capital; mayor que 0 y como máximo el saldo de capital (igual al saldo lo salda)',
  })
  amount: number;

  @Field(() => ID, { description: 'Cuenta de la que sale el abono' })
  accountId: string;

  @Field({
    nullable: true,
    description: 'Fecha del abono (YYYY-MM-DD); por defecto hoy',
  })
  paidOn?: string;

  @Field(() => LoanPrepaymentMode)
  mode: LoanPrepaymentMode;
}

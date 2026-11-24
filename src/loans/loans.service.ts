import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import {
  addMonths,
  roundToCents,
} from '../installments/installment-calculator';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { Expense } from '../transactions/entities/expense.entity';
import { ExpensesService } from '../transactions/expenses.service';
import {
  CreateLoanInput,
  LoanChargeInput,
  PayLoanInstallmentInput,
  PrepayLoanInput,
  UpdateLoanInput,
} from './dto/loan.inputs';
import { LoanCharge, LoanChargeMode } from './entities/loan-charge.entity';
import {
  LoanInstallment,
  LoanInstallmentStatus,
} from './entities/loan-installment.entity';
import {
  LoanPrepayment,
  LoanPrepaymentMode,
} from './entities/loan-prepayment.entity';
import { Loan, LoanRateType, LoanStatus } from './entities/loan.entity';
import {
  LoanChargeSpec,
  LoanInstallmentBreakdown,
  MAX_LOAN_INSTALLMENTS,
  calculateLoanSchedule,
  calculateLoanScheduleWithPayment,
  effectiveAnnualToMonthly,
  roundRate,
} from './loan-calculator';

// tasas máximas aceptadas (en decimal): 1000% EA o 100% mensual
const MAX_EFFECTIVE_ANNUAL_RATE = 10;
const MAX_MONTHLY_RATE = 1;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toCents = (amount: number): number => Math.round(amount * 100);
const today = (): string => new Date().toISOString().substring(0, 10);

export interface LoanSummary {
  outstandingPrincipal: number;
  totalInterest: number;
  totalCharges: number;
  nextInstallment: LoanInstallment | null;
}

/**
 * Totales de un crédito a partir de su tabla actual: el saldo de capital es
 * el capital de las cuotas pendientes (los abonos ya lo descontaron al
 * regenerarlas) y los totales suman pagadas + pendientes.
 */
export function summarizeLoan(installments: LoanInstallment[]): LoanSummary {
  const pending = installments
    .filter((item) => item.status === LoanInstallmentStatus.PENDING)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const sum = (
    items: LoanInstallment[],
    pick: (i: LoanInstallment) => number,
  ) => items.reduce((total, item) => total + toCents(pick(item)), 0) / 100;
  return {
    outstandingPrincipal: sum(pending, (item) => item.principalAmount),
    totalInterest: sum(installments, (item) => item.interestAmount),
    totalCharges: sum(installments, (item) => item.chargesAmount),
    nextInstallment: pending[0] ?? null,
  };
}

/**
 * Créditos personales. Desembolso, pagos y abonos mueven el saldo de las
 * cuentas: el desembolso con `adjustBalance` (no es un ingreso) y los pagos y
 * abonos como gastos normales vía `ExpensesService.create`, para que apliquen
 * el cupo de las tarjetas y los presupuestos.
 *
 * `ExpensesService.create` abre su propia transacción y no acepta un
 * EntityManager, así que pagar y abonar se hacen como una saga corta: primero
 * se registra el gasto y luego, en una transacción con el crédito bloqueado
 * (`FOR UPDATE`), se marca la cuota o se regenera la tabla. Si ese segundo
 * paso falla, se borra el gasto (`ExpensesService.remove` devuelve el saldo).
 */
@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(LoanCharge)
    private readonly chargesRepository: Repository<LoanCharge>,
    @InjectRepository(LoanInstallment)
    private readonly installmentsRepository: Repository<LoanInstallment>,
    @InjectRepository(LoanPrepayment)
    private readonly prepaymentsRepository: Repository<LoanPrepayment>,
    private readonly accountsService: PaymentMethodsService,
    private readonly categoriesService: CategoriesService,
    private readonly expensesService: ExpensesService,
    private readonly dataSource: DataSource,
  ) {}

  findAll(userId: string): Promise<Loan[]> {
    return this.loansRepository.find({
      where: { userId },
      order: { disbursedOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Loan> {
    const loan = await this.loansRepository.findOne({ where: { id, userId } });
    if (!loan) {
      throw new NotFoundException(`Crédito ${id} no encontrado`);
    }
    return loan;
  }

  findInstallments(loanId: string): Promise<LoanInstallment[]> {
    return this.installmentsRepository.find({
      where: { loanId },
      order: { sequenceNumber: 'ASC' },
    });
  }

  findCharges(loanId: string): Promise<LoanCharge[]> {
    return this.chargesRepository.find({
      where: { loanId },
      order: { name: 'ASC' },
    });
  }

  findPrepayments(loanId: string): Promise<LoanPrepayment[]> {
    return this.prepaymentsRepository.find({
      where: { loanId },
      order: { paidOn: 'ASC', createdAt: 'ASC' },
    });
  }

  async summarize(loanId: string): Promise<LoanSummary> {
    return summarizeLoan(await this.findInstallments(loanId));
  }

  async create(userId: string, input: CreateLoanInput): Promise<Loan> {
    const name = this.requireName(input.name);
    const principal = this.requirePositiveAmount(input.principalAmount);
    const { installmentCount } = input;
    if (
      !Number.isInteger(installmentCount) ||
      installmentCount < 1 ||
      installmentCount > MAX_LOAN_INSTALLMENTS
    ) {
      throw new BadRequestException(
        `installmentCount debe ser un entero entre 1 y ${MAX_LOAN_INSTALLMENTS}`,
      );
    }
    const monthlyRate = this.resolveMonthlyRate(input.rateType, input.rate);
    this.assertDate(input.disbursedOn, 'disbursedOn');
    const firstDueDate = input.firstDueDate ?? addMonths(input.disbursedOn, 1);
    this.assertDate(firstDueDate, 'firstDueDate');
    if (firstDueDate < input.disbursedOn) {
      throw new BadRequestException(
        'La primera cuota no puede vencer antes del desembolso',
      );
    }
    const charges = (input.charges ?? []).map((charge) =>
      this.normalizeCharge(charge),
    );

    await this.accountsService.assertOwned(input.disbursementAccountId, userId);
    await this.accountsService.assertOwned(input.paymentAccountId, userId);
    await this.assertExpenseCategory(input.categoryId, userId);

    const schedule = calculateLoanSchedule({
      principal,
      installmentCount,
      monthlyRate,
      firstDueDate,
      charges: charges.map((charge) => this.toChargeSpec(charge)),
    });

    const loanId = await this.dataSource.transaction(async (manager) => {
      const loan = await manager.save(
        Loan,
        this.loansRepository.create({
          userId,
          name,
          lender: input.lender?.trim() || null,
          principalAmount: principal,
          currency: input.currency ?? 'COP',
          rateType: input.rateType,
          rate: roundRate(input.rate),
          monthlyRate,
          installmentCount,
          disbursedOn: input.disbursedOn,
          firstDueDate,
          disbursementAccountId: input.disbursementAccountId ?? null,
          paymentAccountId: input.paymentAccountId ?? null,
          categoryId: input.categoryId ?? null,
          status: LoanStatus.ACTIVE,
        }),
      );
      if (charges.length) {
        await manager.save(
          LoanCharge,
          charges.map((charge) =>
            this.chargesRepository.create({ ...charge, loanId: loan.id }),
          ),
        );
      }
      await manager.save(
        LoanInstallment,
        schedule.map((part) =>
          this.installmentsRepository.create({ ...part, loanId: loan.id }),
        ),
      );
      // el desembolso entra a la cuenta, pero no es un ingreso
      await this.accountsService.adjustBalance(
        input.disbursementAccountId ?? null,
        principal,
        manager,
      );
      return loan.id;
    });

    return this.findOne(loanId, userId);
  }

  /**
   * Solo cambia datos descriptivos (nombre, entidad, categoría y cuenta de
   * pagos). Las condiciones financieras son inmutables: si estaban mal, se
   * borra el crédito (mientras no tenga pagos) y se crea de nuevo.
   */
  async update(userId: string, input: UpdateLoanInput): Promise<Loan> {
    const loan = await this.findOne(input.id, userId);
    if (input.name !== undefined) {
      loan.name = this.requireName(input.name);
    }
    if (input.lender !== undefined) {
      loan.lender = input.lender?.trim() || null;
    }
    if (input.categoryId !== undefined) {
      await this.assertExpenseCategory(input.categoryId, userId);
      loan.categoryId = input.categoryId;
    }
    if (input.paymentAccountId !== undefined) {
      await this.accountsService.assertOwned(input.paymentAccountId, userId);
      loan.paymentAccountId = input.paymentAccountId;
    }
    await this.loansRepository.save(loan);
    return this.findOne(loan.id, userId);
  }

  /**
   * Borra un crédito sin pagos ni abonos (sus cuotas y cargos caen en
   * cascada) y retira el desembolso de la cuenta.
   */
  async remove(id: string, userId: string): Promise<boolean> {
    const loan = await this.findOne(id, userId);
    const [paid, prepayments] = await Promise.all([
      this.installmentsRepository.count({
        where: { loanId: id, status: LoanInstallmentStatus.PAID },
      }),
      this.prepaymentsRepository.count({ where: { loanId: id } }),
    ]);
    if (paid > 0 || prepayments > 0) {
      throw new BadRequestException(
        'No se puede borrar un crédito con cuotas pagadas o abonos registrados',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.accountsService.adjustBalance(
        loan.disbursementAccountId,
        -loan.principalAmount,
        manager,
      );
      await manager.delete(Loan, { id: loan.id });
    });
    return true;
  }

  /**
   * Paga la cuota pendiente más antigua (las cuotas se pagan en orden) con un
   * gasto "<crédito> (n/N)". Al pagar la última, el crédito queda saldado. El
   * gasto (saldo y cupo incluidos) y la marca de la cuota van en una sola
   * transacción, con el crédito bloqueado para serializar pagos y abonos.
   */
  async payInstallment(
    userId: string,
    input: PayLoanInstallmentInput,
  ): Promise<LoanInstallment> {
    const installment = await this.installmentsRepository.findOne({
      where: { id: input.installmentId, loan: { userId } },
      relations: { loan: true },
    });
    if (!installment) {
      throw new NotFoundException(`Cuota ${input.installmentId} no encontrada`);
    }
    const { loan } = installment;
    const accountId = input.accountId ?? loan.paymentAccountId;
    if (!accountId) {
      throw new BadRequestException(
        'Indica la cuenta del pago (accountId) o configura la cuenta de pagos del crédito',
      );
    }
    const paidOn = input.paidOn ?? today();
    this.assertDate(paidOn, 'paidOn');

    const expense = await this.dataSource.transaction(async (manager) => {
      await this.lockLoan(manager, loan.id);
      const current = await manager.findOne(LoanInstallment, {
        where: { id: installment.id },
      });
      if (!current || current.status === LoanInstallmentStatus.PAID) {
        throw new BadRequestException('La cuota ya está pagada');
      }
      const next = await manager.findOne(LoanInstallment, {
        where: { loanId: loan.id, status: LoanInstallmentStatus.PENDING },
        order: { sequenceNumber: 'ASC' },
      });
      if (next && next.id !== current.id) {
        throw new BadRequestException(
          `Las cuotas se pagan en orden: primero la cuota ${next.sequenceNumber}`,
        );
      }
      const total = await manager.count(LoanInstallment, {
        where: { loanId: loan.id },
      });

      const created = await this.expensesService.create(
        userId,
        {
          description: `${loan.name} (${current.sequenceNumber}/${total})`,
          amount: current.amount,
          accountId,
          categoryId: loan.categoryId ?? undefined,
          currency: loan.currency,
          occurredOn: paidOn,
        },
        manager,
      );
      // marca el gasto como del crédito: no se edita ni borra desde Movimientos
      await manager.update(Expense, created.id, { loanId: loan.id });
      await manager.update(LoanInstallment, current.id, {
        status: LoanInstallmentStatus.PAID,
        paidOn,
        expenseId: created.id,
      });
      const pending = await manager.count(LoanInstallment, {
        where: { loanId: loan.id, status: LoanInstallmentStatus.PENDING },
      });
      if (pending === 0) {
        await manager.update(Loan, loan.id, { status: LoanStatus.PAID_OFF });
      }
      return created;
    });
    // ya confirmado: ahora sí se puede revisar el presupuesto
    this.expensesService.scheduleBudgetCheck(userId, expense);

    return this.installmentsRepository.findOneOrFail({
      where: { id: installment.id },
    });
  }

  /**
   * Abono extraordinario a capital: se registra como gasto y se regeneran
   * solo las cuotas pendientes desde el nuevo saldo, con la misma tasa y
   * cargos y conservando la numeración. REDUCE_PAYMENT mantiene el número de
   * cuotas; REDUCE_TERM mantiene la cuota (capital + interés) y acorta el
   * plazo. Un abono igual al saldo salda el crédito. Todo va en una sola
   * transacción con el crédito bloqueado.
   */
  async prepay(userId: string, input: PrepayLoanInput): Promise<Loan> {
    const loan = await this.findOne(input.loanId, userId);
    const amount = this.requirePositiveAmount(input.amount);
    const paidOn = input.paidOn ?? today();
    this.assertDate(paidOn, 'paidOn');

    const expense = await this.dataSource.transaction(async (manager) => {
      await this.lockLoan(manager, loan.id);
      const pending = await this.findPending(manager, loan.id);
      if (pending.length === 0) {
        throw new BadRequestException('El crédito ya está saldado');
      }
      const outstandingCents = this.principalCents(pending);
      if (toCents(amount) > outstandingCents) {
        throw new BadRequestException(
          `El abono supera el saldo de capital (${outstandingCents / 100})`,
        );
      }

      const created = await this.expensesService.create(
        userId,
        {
          description: `Abono a capital ${loan.name}`,
          amount,
          accountId: input.accountId,
          categoryId: loan.categoryId ?? undefined,
          currency: loan.currency,
          occurredOn: paidOn,
        },
        manager,
      );
      // marca el gasto como del crédito: no se edita ni borra desde Movimientos
      await manager.update(Expense, created.id, { loanId: loan.id });
      const charges = await manager.find(LoanCharge, {
        where: { loanId: loan.id },
      });
      const schedule = this.reschedule(
        loan,
        pending,
        (outstandingCents - toCents(amount)) / 100,
        input.mode,
        charges,
      );

      // actualiza en sitio (conserva ids), borra las sobrantes y crea las
      // que falten
      for (const [index, part] of schedule.entries()) {
        const existing = pending[index];
        if (existing) {
          await manager.update(LoanInstallment, existing.id, { ...part });
        } else {
          await manager.save(
            LoanInstallment,
            this.installmentsRepository.create({ ...part, loanId: loan.id }),
          );
        }
      }
      const surplus = pending.slice(schedule.length);
      if (surplus.length) {
        await manager.delete(LoanInstallment, {
          id: In(surplus.map((item) => item.id)),
        });
      }
      await manager.save(
        LoanPrepayment,
        this.prepaymentsRepository.create({
          loanId: loan.id,
          amount,
          paidOn,
          mode: input.mode,
          expenseId: created.id,
        }),
      );
      if (schedule.length === 0) {
        await manager.update(Loan, loan.id, { status: LoanStatus.PAID_OFF });
      }
      return created;
    });
    this.expensesService.scheduleBudgetCheck(userId, expense);

    return this.findOne(loan.id, userId);
  }

  private reschedule(
    loan: Loan,
    pending: LoanInstallment[],
    principal: number,
    mode: LoanPrepaymentMode,
    charges: LoanCharge[],
  ): LoanInstallmentBreakdown[] {
    if (principal <= 0 || pending.length === 0) {
      return [];
    }
    const base = {
      principal,
      monthlyRate: loan.monthlyRate,
      firstDueDate: loan.firstDueDate,
      charges: charges.map((charge) => this.toChargeSpec(charge)),
      startSequence: pending[0].sequenceNumber,
    };
    if (mode === LoanPrepaymentMode.REDUCE_PAYMENT) {
      return calculateLoanSchedule({
        ...base,
        installmentCount: pending.length,
      });
    }
    // REDUCE_TERM: la cuota vigente (capital + interés, sin cargos)
    const payment = roundToCents(
      pending[0].principalAmount + pending[0].interestAmount,
    );
    return calculateLoanScheduleWithPayment({ ...base, payment });
  }

  private findPending(
    manager: EntityManager,
    loanId: string,
  ): Promise<LoanInstallment[]> {
    return manager.find(LoanInstallment, {
      where: { loanId, status: LoanInstallmentStatus.PENDING },
      order: { sequenceNumber: 'ASC' },
    });
  }

  private principalCents(installments: LoanInstallment[]): number {
    return installments.reduce(
      (sum, item) => sum + toCents(item.principalAmount),
      0,
    );
  }

  // serializa pagos y abonos del mismo crédito
  private async lockLoan(
    manager: EntityManager,
    loanId: string,
  ): Promise<void> {
    await manager.findOne(Loan, {
      where: { id: loanId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private resolveMonthlyRate(rateType: LoanRateType, rate: number): number {
    if (!Number.isFinite(rate) || rate < 0) {
      throw new BadRequestException('La tasa no puede ser negativa');
    }
    if (rateType === LoanRateType.EFFECTIVE_ANNUAL) {
      if (rate > MAX_EFFECTIVE_ANNUAL_RATE) {
        throw new BadRequestException(
          'La tasa efectiva anual debe estar entre 0 y 10 (1000%)',
        );
      }
      return effectiveAnnualToMonthly(rate);
    }
    if (rate > MAX_MONTHLY_RATE) {
      throw new BadRequestException(
        'La tasa mensual debe estar entre 0 y 1 (100%)',
      );
    }
    return roundRate(rate);
  }

  private normalizeCharge(input: LoanChargeInput): LoanChargeInput {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Cada cargo requiere un nombre');
    }
    if (!Number.isFinite(input.value) || input.value < 0) {
      throw new BadRequestException(
        `El valor del cargo "${name}" no puede ser negativo`,
      );
    }
    if (input.mode === LoanChargeMode.PERCENT_OF_BALANCE && input.value > 1) {
      throw new BadRequestException(
        `El porcentaje del cargo "${name}" debe ser una fracción entre 0 y 1`,
      );
    }
    return {
      ...input,
      name,
      value:
        input.mode === LoanChargeMode.FIXED
          ? roundToCents(input.value)
          : roundRate(input.value),
    };
  }

  private toChargeSpec(charge: {
    mode: LoanChargeMode;
    value: number;
  }): LoanChargeSpec {
    return {
      mode:
        charge.mode === LoanChargeMode.FIXED ? 'fixed' : 'percent_of_balance',
      value: charge.value,
    };
  }

  private async assertExpenseCategory(
    categoryId: string | null | undefined,
    userId: string,
  ): Promise<void> {
    if (!categoryId) {
      return;
    }
    const category = await this.categoriesService.findOne(categoryId, userId);
    if (category.kind !== TransactionKind.EXPENSE) {
      throw new BadRequestException(
        'La categoría de los pagos debe ser de gasto',
      );
    }
  }

  private requireName(name: string | null | undefined): string {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('El crédito requiere un nombre');
    }
    return trimmed;
  }

  private requirePositiveAmount(amount: number): number {
    const rounded = Number.isFinite(amount) ? roundToCents(amount) : 0;
    if (rounded <= 0) {
      throw new BadRequestException('El monto debe ser mayor que 0');
    }
    return rounded;
  }

  private assertDate(value: string, field: string): void {
    if (
      !DATE_PATTERN.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ) {
      throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD`);
    }
  }
}

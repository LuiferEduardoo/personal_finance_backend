import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, FindOperator, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ExpensesService } from '../transactions/expenses.service';
import { LoanCharge } from './entities/loan-charge.entity';
import {
  LoanInstallment,
  LoanInstallmentStatus,
} from './entities/loan-installment.entity';
import {
  LoanPrepayment,
  LoanPrepaymentMode,
} from './entities/loan-prepayment.entity';
import { Loan, LoanRateType, LoanStatus } from './entities/loan.entity';
import { calculateLoanSchedule } from './loan-calculator';
import { LoansService, summarizeLoan } from './loans.service';

const USER = 'user-1';

type Where = Record<string, unknown>;

// almacén en memoria que imita lo justo de los repositorios y del manager
function setup(options: { installments?: Partial<LoanInstallment>[] } = {}) {
  let ids = 0;
  const state = {
    loan: null as Loan | null,
    installments: [] as LoanInstallment[],
    prepayments: [] as LoanPrepayment[],
  };

  const matches = (item: object, where: Where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'loan') {
        return (
          state.loan?.userId === (value as { userId: string }).userId &&
          (item as LoanInstallment).loanId === state.loan?.id
        );
      }
      return (item as Record<string, unknown>)[key] === value;
    });
  const pickInstallments = (where?: Where) =>
    state.installments
      .filter((item) => matches(item, where))
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const storeInstallments = (values: Partial<LoanInstallment>[]) => {
    for (const value of values) {
      state.installments.push({
        status: LoanInstallmentStatus.PENDING,
        paidOn: null,
        expenseId: null,
        ...value,
        id: value.id ?? `inst-${++ids}`,
      } as LoanInstallment);
    }
  };

  const manager = {
    save: jest.fn((entity: unknown, value: object | object[]) => {
      if (entity === Loan) {
        state.loan = {
          ...(value as Loan),
          id: 'loan-1',
          status: LoanStatus.ACTIVE,
        };
        return Promise.resolve(state.loan);
      }
      if (entity === LoanInstallment) {
        storeInstallments(
          (Array.isArray(value) ? value : [value]) as LoanInstallment[],
        );
      }
      if (entity === LoanPrepayment) {
        state.prepayments.push({ ...(value as LoanPrepayment), id: 'pre-1' });
      }
      return Promise.resolve(value);
    }),
    update: jest.fn((entity: unknown, id: string, patch: object) => {
      if (entity === Loan) {
        Object.assign(state.loan!, patch);
      } else {
        Object.assign(
          state.installments.find((i) => i.id === id)!,
          patch,
        );
      }
      return Promise.resolve({ affected: 1 });
    }),
    delete: jest.fn((entity: unknown, where: { id: unknown }) => {
      if (entity === Loan) {
        state.loan = null;
      } else {
        const removed = (where.id as FindOperator<string[]>).value;
        state.installments = state.installments.filter(
          (item) => !removed.includes(item.id),
        );
      }
      return Promise.resolve({ affected: 1 });
    }),
    findOne: jest.fn((entity: unknown, opts: { where: Where }) =>
      Promise.resolve(
        entity === Loan
          ? state.loan
          : (pickInstallments(opts.where)[0] ?? null),
      ),
    ),
    find: jest.fn((entity: unknown, opts: { where: Where }) =>
      Promise.resolve(
        entity === LoanInstallment ? pickInstallments(opts.where) : [],
      ),
    ),
    count: jest.fn((_entity: unknown, opts: { where: Where }) =>
      Promise.resolve(pickInstallments(opts.where).length),
    ),
  };

  const loansRepository = {
    findOne: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(
        state.loan && matches(state.loan, where) ? { ...state.loan } : null,
      ),
    ),
    create: jest.fn((value: object) => value),
  };
  const installmentsRepository = {
    findOne: jest.fn(({ where }: { where: Where }) => {
      const found = pickInstallments(where)[0];
      return Promise.resolve(found ? { ...found, loan: state.loan } : null);
    }),
    findOneOrFail: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(pickInstallments(where)[0]),
    ),
    find: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(pickInstallments(where).map((item) => ({ ...item }))),
    ),
    count: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(pickInstallments(where).length),
    ),
    create: jest.fn((value: object) => value),
  };
  const prepaymentsRepository = {
    count: jest.fn(() => Promise.resolve(state.prepayments.length)),
    create: jest.fn((value: object) => value),
  };
  const chargesRepository = { create: jest.fn((value: object) => value) };
  const accountsService = {
    assertOwned: jest.fn().mockResolvedValue(undefined),
    adjustBalance: jest.fn().mockResolvedValue(undefined),
  };
  const categoriesService = {
    findOne: jest.fn().mockResolvedValue({ id: 'cat-1', kind: 'expense' }),
  };
  let expenses = 0;
  const expensesService = {
    create: jest.fn(() => Promise.resolve({ id: `exp-${++expenses}` })),
    remove: jest.fn().mockResolvedValue(true),
    scheduleBudgetCheck: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
    ),
  };

  const service = new LoansService(
    loansRepository as unknown as Repository<Loan>,
    chargesRepository as unknown as Repository<LoanCharge>,
    installmentsRepository as unknown as Repository<LoanInstallment>,
    prepaymentsRepository as unknown as Repository<LoanPrepayment>,
    accountsService as unknown as PaymentMethodsService,
    categoriesService as unknown as CategoriesService,
    expensesService as unknown as ExpensesService,
    dataSource as unknown as DataSource,
  );
  if (options.installments) {
    storeInstallments(options.installments);
  }
  return { service, state, manager, accountsService, expensesService };
}

const baseInput = {
  name: 'Libre inversión',
  lender: 'Banco',
  principalAmount: 1_200,
  rateType: LoanRateType.MONTHLY,
  rate: 0,
  installmentCount: 3,
  disbursedOn: '2026-01-10',
  disbursementAccountId: 'acc-1',
  paymentAccountId: 'acc-2',
  categoryId: 'cat-1',
};

async function createLoan(
  ctx: ReturnType<typeof setup>,
  input: Partial<typeof baseInput> = {},
) {
  return ctx.service.create(USER, { ...baseInput, ...input });
}

describe('LoansService.create', () => {
  it('crea la tabla y suma el desembolso a la cuenta (no es ingreso)', async () => {
    const ctx = setup();
    const loan = await createLoan(ctx);

    expect(loan.firstDueDate).toBe('2026-02-10');
    expect(ctx.state.installments.map((i) => i.amount)).toEqual([
      400, 400, 400,
    ]);
    expect(ctx.accountsService.assertOwned).toHaveBeenCalledWith('acc-1', USER);
    expect(ctx.accountsService.adjustBalance).toHaveBeenCalledWith(
      'acc-1',
      1_200,
      ctx.manager,
    );
    expect(ctx.expensesService.create).not.toHaveBeenCalled();
  });

  it('convierte la tasa EA a mensual', async () => {
    const ctx = setup();
    const loan = await createLoan(ctx, {
      rateType: LoanRateType.EFFECTIVE_ANNUAL,
      rate: 0.24,
    });
    expect(loan.rate).toBe(0.24);
    expect(loan.monthlyRate).toBeCloseTo(0.0180876, 7);
  });

  it.each([
    [{ principalAmount: 0 }],
    [{ rate: 11, rateType: LoanRateType.EFFECTIVE_ANNUAL }],
    [{ rate: 1.5 }],
    [{ rate: -0.01 }],
    [{ installmentCount: 601 }],
  ])('rechaza datos inválidos %o', async (input) => {
    const ctx = setup();
    await expect(createLoan(ctx, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('LoansService.payInstallment', () => {
  it('paga en orden con un gasto "<nombre> (n/N)"', async () => {
    const ctx = setup();
    await createLoan(ctx);
    const [first] = ctx.state.installments;

    const paid = await ctx.service.payInstallment(USER, {
      installmentId: first.id,
      paidOn: '2026-02-10',
    });

    expect(ctx.expensesService.create).toHaveBeenCalledWith(
      USER,
      {
        description: 'Libre inversión (1/3)',
        amount: 400,
        accountId: 'acc-2',
        categoryId: 'cat-1',
        currency: 'COP',
        occurredOn: '2026-02-10',
      },
      ctx.manager,
    );
    expect(ctx.expensesService.scheduleBudgetCheck).toHaveBeenCalledWith(USER, {
      id: 'exp-1',
    });
    expect(paid).toMatchObject({
      status: LoanInstallmentStatus.PAID,
      paidOn: '2026-02-10',
      expenseId: 'exp-1',
    });
    expect(ctx.state.loan!.status).toBe(LoanStatus.ACTIVE);
  });

  it('rechaza pagar fuera de orden', async () => {
    const ctx = setup();
    await createLoan(ctx);
    const second = ctx.state.installments[1];

    await expect(
      ctx.service.payInstallment(USER, { installmentId: second.id }),
    ).rejects.toThrow('primero la cuota 1');
    expect(ctx.expensesService.create).not.toHaveBeenCalled();
  });

  it('la última cuota deja el crédito saldado', async () => {
    const ctx = setup();
    await createLoan(ctx);
    for (const installment of [...ctx.state.installments]) {
      await ctx.service.payInstallment(USER, {
        installmentId: installment.id,
      });
    }
    expect(ctx.state.loan!.status).toBe(LoanStatus.PAID_OFF);
    expect(ctx.expensesService.create).toHaveBeenCalledTimes(3);
  });

  it('sin cuenta de pago ni accountId se rechaza', async () => {
    const ctx = setup();
    await createLoan(ctx, { paymentAccountId: undefined });
    await expect(
      ctx.service.payInstallment(USER, {
        installmentId: ctx.state.installments[0].id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el gasto va en la misma transacción: si falla marcar la cuota, no se revisa el presupuesto', async () => {
    const ctx = setup();
    await createLoan(ctx);
    ctx.manager.update.mockRejectedValueOnce(new Error('db caída'));

    await expect(
      ctx.service.payInstallment(USER, {
        installmentId: ctx.state.installments[0].id,
      }),
    ).rejects.toThrow('db caída');
    expect(ctx.expensesService.create).toHaveBeenCalledWith(
      USER,
      expect.any(Object),
      ctx.manager,
    );
    // el rollback de la transacción deshace el gasto: no hay compensación
    expect(ctx.expensesService.remove).not.toHaveBeenCalled();
    expect(ctx.expensesService.scheduleBudgetCheck).not.toHaveBeenCalled();
  });

  it('no encuentra cuotas de créditos de otro usuario', async () => {
    const ctx = setup();
    await createLoan(ctx);
    await expect(
      ctx.service.payInstallment('otro', {
        installmentId: ctx.state.installments[0].id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LoansService.prepay', () => {
  async function loanWithRate(ctx: ReturnType<typeof setup>) {
    await createLoan(ctx, {
      principalAmount: 12_000,
      rate: 0.01,
      installmentCount: 12,
    });
    // paga la primera para comprobar que se conserva la numeración
    await ctx.service.payInstallment(USER, {
      installmentId: ctx.state.installments[0].id,
    });
  }

  it('REDUCE_PAYMENT conserva el número de cuotas y baja la cuota', async () => {
    const ctx = setup();
    await loanWithRate(ctx);
    const before = summarizeLoan(ctx.state.installments);
    const oldPayment = ctx.state.installments[1].amount;

    await ctx.service.prepay(USER, {
      loanId: 'loan-1',
      amount: 3_000,
      accountId: 'acc-2',
      mode: LoanPrepaymentMode.REDUCE_PAYMENT,
      paidOn: '2026-03-01',
    });

    const pending = ctx.state.installments.filter(
      (i) => i.status === LoanInstallmentStatus.PENDING,
    );
    expect(pending.map((i) => i.sequenceNumber)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(pending[0].amount).toBeLessThan(oldPayment);
    expect(summarizeLoan(ctx.state.installments).outstandingPrincipal).toBe(
      Math.round((before.outstandingPrincipal - 3_000) * 100) / 100,
    );
    expect(ctx.expensesService.create).toHaveBeenLastCalledWith(
      USER,
      {
        description: 'Abono a capital Libre inversión',
        amount: 3_000,
        accountId: 'acc-2',
        categoryId: 'cat-1',
        currency: 'COP',
        occurredOn: '2026-03-01',
      },
      ctx.manager,
    );
    expect(ctx.state.prepayments).toHaveLength(1);
  });

  it('REDUCE_TERM conserva la cuota y acorta el plazo', async () => {
    const ctx = setup();
    await loanWithRate(ctx);
    const oldPayment = ctx.state.installments[1].amount;
    const keptIds = ctx.state.installments.slice(1).map((i) => i.id);

    await ctx.service.prepay(USER, {
      loanId: 'loan-1',
      amount: 3_000,
      accountId: 'acc-2',
      mode: LoanPrepaymentMode.REDUCE_TERM,
    });

    const pending = ctx.state.installments.filter(
      (i) => i.status === LoanInstallmentStatus.PENDING,
    );
    expect(pending.length).toBeLessThan(11);
    expect(pending[0].sequenceNumber).toBe(2);
    expect(pending.slice(0, -1).every((i) => i.amount === oldPayment)).toBe(
      true,
    );
    // actualiza en sitio: conserva los ids de las que siguen
    expect(pending.map((i) => i.id)).toEqual(keptIds.slice(0, pending.length));
  });

  it('un abono igual al saldo salda el crédito', async () => {
    const ctx = setup();
    await loanWithRate(ctx);
    const { outstandingPrincipal } = summarizeLoan(ctx.state.installments);

    await ctx.service.prepay(USER, {
      loanId: 'loan-1',
      amount: outstandingPrincipal,
      accountId: 'acc-2',
      mode: LoanPrepaymentMode.REDUCE_TERM,
    });

    expect(
      ctx.state.installments.filter(
        (i) => i.status === LoanInstallmentStatus.PENDING,
      ),
    ).toHaveLength(0);
    expect(ctx.state.loan!.status).toBe(LoanStatus.PAID_OFF);
  });

  it.each([0, -5, 1_000_000])('rechaza el abono %p', async (amount) => {
    const ctx = setup();
    await loanWithRate(ctx);
    await expect(
      ctx.service.prepay(USER, {
        loanId: 'loan-1',
        amount,
        accountId: 'acc-2',
        mode: LoanPrepaymentMode.REDUCE_TERM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LoansService.remove', () => {
  it('borra el crédito y retira el desembolso', async () => {
    const ctx = setup();
    await createLoan(ctx);

    await expect(ctx.service.remove('loan-1', USER)).resolves.toBe(true);
    expect(ctx.accountsService.adjustBalance).toHaveBeenLastCalledWith(
      'acc-1',
      -1_200,
      ctx.manager,
    );
    expect(ctx.state.loan).toBeNull();
  });

  it('se rechaza si ya hay una cuota pagada', async () => {
    const ctx = setup();
    await createLoan(ctx);
    await ctx.service.payInstallment(USER, {
      installmentId: ctx.state.installments[0].id,
    });

    await expect(ctx.service.remove('loan-1', USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.state.loan).not.toBeNull();
  });
});

describe('summarizeLoan', () => {
  it('saldo = capital pendiente; totales sobre toda la tabla', () => {
    const schedule = calculateLoanSchedule({
      principal: 1_000,
      installmentCount: 2,
      monthlyRate: 0.01,
      firstDueDate: '2026-01-01',
      charges: [{ mode: 'fixed', value: 5 }],
    }).map(
      (part, index) =>
        ({
          ...part,
          id: `i${index}`,
          status:
            index === 0
              ? LoanInstallmentStatus.PAID
              : LoanInstallmentStatus.PENDING,
        }) as LoanInstallment,
    );

    const summary = summarizeLoan(schedule);
    expect(summary.outstandingPrincipal).toBe(schedule[1].principalAmount);
    expect(summary.totalCharges).toBe(10);
    expect(summary.totalInterest).toBe(
      schedule[0].interestAmount + schedule[1].interestAmount,
    );
    expect(summary.nextInstallment?.id).toBe('i1');
  });
});

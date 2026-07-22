import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CreateAccountInput } from './dto/create-account.input';
import { TransferInput } from './dto/transfer.input';
import { UpdateAccountInput } from './dto/update-account.input';
import { AccountTransfer } from './entities/account-transfer.entity';
import {
  PaymentMethod,
  PaymentMethodType,
} from './entities/payment-method.entity';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly accountsRepository: Repository<PaymentMethod>,
    @InjectRepository(AccountTransfer)
    private readonly transfersRepository: Repository<AccountTransfer>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(userId: string, includeInactive = false): Promise<PaymentMethod[]> {
    return this.accountsRepository.find({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<PaymentMethod> {
    const account = await this.accountsRepository.findOne({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException(`Cuenta ${id} no encontrada`);
    }
    return account;
  }

  create(userId: string, input: CreateAccountInput): Promise<PaymentMethod> {
    const account = this.accountsRepository.create({
      ...input,
      userId,
      balance: input.openingBalance ?? 0,
    });
    return this.accountsRepository.save(account);
  }

  async update(
    userId: string,
    input: UpdateAccountInput,
  ): Promise<PaymentMethod> {
    const account = await this.findOne(input.id, userId);
    const { id, openingBalance, ...changes } = input;
    // cambiar el saldo inicial ajusta el saldo actual por el mismo delta
    if (openingBalance !== undefined) {
      account.balance += openingBalance - account.openingBalance;
      account.openingBalance = openingBalance;
    }
    Object.assign(account, changes);
    await this.accountsRepository.save(account);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const account = await this.findOne(id, userId);
    try {
      await this.accountsRepository.remove(account);
    } catch (error) {
      // installment_plans / account_transfers referencian con ON DELETE RESTRICT
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(
          'No se puede borrar la cuenta: tiene planes de cuotas o transferencias asociadas',
        );
      }
      throw error;
    }
    return true;
  }

  // --- saldo ---

  // ajuste atómico a nivel BD; no-op si la cuenta es null
  async adjustBalance(accountId: string | null, delta: number): Promise<void> {
    if (!accountId || delta === 0) {
      return;
    }
    await this.accountsRepository.increment(
      { id: accountId },
      'balance',
      delta,
    );
  }

  // valida el cupo antes de un gasto en tarjeta de crédito
  async assertCreditAvailable(
    accountId: string,
    amount: number,
  ): Promise<void> {
    const account = await this.accountsRepository.findOne({
      where: { id: accountId },
    });
    if (!account || account.type !== PaymentMethodType.CREDIT) {
      return;
    }
    if (
      account.creditLimit != null &&
      amount > account.creditLimit + account.balance
    ) {
      throw new BadRequestException(
        'El gasto excede el cupo disponible de la tarjeta',
      );
    }
  }

  // recomputa el saldo desde los movimientos (válvula ante descuadres)
  async recalculateBalance(id: string, userId: string): Promise<PaymentMethod> {
    const account = await this.findOne(id, userId);
    const [row] = await this.accountsRepository.query(
      `
        SELECT
          $2::numeric
          + COALESCE((SELECT SUM("amount") FROM "incomes" WHERE "payment_method_id" = $1), 0)
          - COALESCE((SELECT SUM("amount") FROM "expenses" WHERE "payment_method_id" = $1), 0)
          + COALESCE((SELECT SUM("amount") FROM "account_transfers" WHERE "to_account_id" = $1), 0)
          - COALESCE((SELECT SUM("amount") FROM "account_transfers" WHERE "from_account_id" = $1), 0)
          AS balance
      `,
      [id, account.openingBalance],
    );
    account.balance = Number(row.balance);
    await this.accountsRepository.save(account);
    return account;
  }

  // --- transferencias ---

  findTransfers(
    userId: string,
    accountId?: string,
  ): Promise<AccountTransfer[]> {
    const base = { userId };
    return this.transfersRepository.find({
      where: accountId
        ? [
            { ...base, fromAccountId: accountId },
            { ...base, toAccountId: accountId },
          ]
        : base,
      relations: { fromAccount: true, toAccount: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async transfer(
    userId: string,
    input: TransferInput,
  ): Promise<AccountTransfer> {
    if (input.fromAccountId === input.toAccountId) {
      throw new BadRequestException(
        'Las cuentas origen y destino son la misma',
      );
    }
    if (input.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor que 0');
    }
    const from = await this.findOne(input.fromAccountId, userId);
    const to = await this.findOne(input.toAccountId, userId);

    // fondos en el origen: si es crédito se consume cupo; si no, saldo disponible
    if (from.type === PaymentMethodType.CREDIT) {
      await this.assertCreditAvailable(from.id, input.amount);
    } else if (from.balance < input.amount) {
      throw new BadRequestException('Fondos insuficientes en la cuenta origen');
    }

    const occurredOn =
      input.occurredOn ?? new Date().toISOString().substring(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const transfer = await manager.save(
        manager.create(AccountTransfer, {
          userId,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: input.amount,
          occurredOn,
          note: input.note ?? null,
        }),
      );
      await manager.increment(
        PaymentMethod,
        { id: from.id },
        'balance',
        -input.amount,
      );
      await manager.increment(
        PaymentMethod,
        { id: to.id },
        'balance',
        input.amount,
      );
      const saved = await manager.findOne(AccountTransfer, {
        where: { id: transfer.id },
        relations: { fromAccount: true, toAccount: true },
      });
      return saved!;
    });
  }
}

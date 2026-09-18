import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  DataSource,
  Repository,
} from 'typeorm';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { CreateIncomeInput } from './dto/create-income.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateIncomeInput } from './dto/update-income.input';
import { Income } from './entities/income.entity';

@Injectable()
export class IncomesService {
  constructor(
    @InjectRepository(Income)
    private readonly incomesRepository: Repository<Income>,
    private readonly accountsService: PaymentMethodsService,
    private readonly dataSource: DataSource,
  ) {}

  findAll(userId: string, filter?: TransactionsFilterInput): Promise<Income[]> {
    const where: FindOptionsWhere<Income> = { userId };
    if (filter?.from && filter?.to) {
      where.occurredOn = Between(filter.from, filter.to);
    } else if (filter?.from) {
      where.occurredOn = MoreThanOrEqual(filter.from);
    } else if (filter?.to) {
      where.occurredOn = LessThanOrEqual(filter.to);
    }
    if (filter?.categoryId) {
      where.categoryId = filter.categoryId;
    }
    if (filter?.accountId) {
      where.paymentMethodId = filter.accountId;
    }
    return this.incomesRepository.find({
      where,
      relations: { category: true, paymentMethod: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Income> {
    const income = await this.incomesRepository.findOne({
      where: { id, userId },
      relations: { category: true, paymentMethod: true },
    });
    if (!income) {
      throw new NotFoundException(`Ingreso ${id} no encontrado`);
    }
    return income;
  }

  async create(userId: string, input: CreateIncomeInput): Promise<Income> {
    const { accountId, ...rest } = input;
    await this.accountsService.assertOwned(accountId, userId);
    const income = this.incomesRepository.create({
      ...rest,
      userId,
      paymentMethodId: accountId ?? null,
    });
    const saved = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(Income, income);
      await this.accountsService.adjustBalance(
        accountId ?? null,
        created.amount,
        manager,
      );
      return created;
    });
    return this.findOne(saved.id, userId);
  }

  async update(userId: string, input: UpdateIncomeInput): Promise<Income> {
    const income = await this.findOne(input.id, userId);
    const prevAccountId = income.paymentMethodId;
    const prevAmount = income.amount;

    const { id, accountId, ...changes } = input;
    if (accountId !== undefined) {
      await this.accountsService.assertOwned(accountId, userId);
      income.paymentMethodId = accountId;
    }
    Object.assign(income, changes);
    await this.dataSource.transaction(async (manager) => {
      await manager.save(Income, income);
      if (
        income.paymentMethodId !== prevAccountId ||
        income.amount !== prevAmount
      ) {
        await this.accountsService.adjustBalance(
          prevAccountId,
          -prevAmount,
          manager,
        );
        await this.accountsService.adjustBalance(
          income.paymentMethodId,
          income.amount,
          manager,
        );
      }
    });
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const income = await this.findOne(id, userId);
    // saca el importe de la cuenta
    await this.dataSource.transaction(async (manager) => {
      await this.accountsService.adjustBalance(
        income.paymentMethodId,
        -income.amount,
        manager,
      );
      await manager.remove(Income, income);
    });
    return true;
  }
}

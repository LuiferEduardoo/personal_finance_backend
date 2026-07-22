import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
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

  async findOne(id: string): Promise<Income> {
    const income = await this.incomesRepository.findOne({
      where: { id },
      relations: { category: true, paymentMethod: true },
    });
    if (!income) {
      throw new NotFoundException(`Ingreso ${id} no encontrado`);
    }
    return income;
  }

  async create(input: CreateIncomeInput): Promise<Income> {
    const { accountId, ...rest } = input;
    const income = this.incomesRepository.create({
      ...rest,
      paymentMethodId: accountId ?? null,
    });
    const saved = await this.incomesRepository.save(income);
    // el ingreso entra a la cuenta: sube el saldo
    await this.accountsService.adjustBalance(accountId ?? null, saved.amount);
    return this.findOne(saved.id);
  }

  async update(input: UpdateIncomeInput): Promise<Income> {
    const income = await this.findOne(input.id);
    const prevAccountId = income.paymentMethodId;
    const prevAmount = income.amount;

    const { id, accountId, ...changes } = input;
    if (accountId !== undefined) {
      income.paymentMethodId = accountId;
    }
    Object.assign(income, changes);
    await this.incomesRepository.save(income);

    // revierte el ingreso previo y aplica el nuevo
    if (
      income.paymentMethodId !== prevAccountId ||
      income.amount !== prevAmount
    ) {
      await this.accountsService.adjustBalance(prevAccountId, -prevAmount);
      await this.accountsService.adjustBalance(
        income.paymentMethodId,
        income.amount,
      );
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const income = await this.findOne(id);
    // saca el importe de la cuenta
    await this.accountsService.adjustBalance(
      income.paymentMethodId,
      -income.amount,
    );
    await this.incomesRepository.remove(income);
    return true;
  }
}

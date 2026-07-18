import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { CreateExpenseInput } from './dto/create-expense.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateExpenseInput } from './dto/update-expense.input';
import { Expense } from './entities/expense.entity';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  findAll(
    userId: string,
    filter?: TransactionsFilterInput,
  ): Promise<Expense[]> {
    const where: FindOptionsWhere<Expense> = { userId };
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
    if (filter?.paymentMethodId) {
      where.paymentMethodId = filter.paymentMethodId;
    }
    return this.expensesRepository.find({
      where,
      relations: { category: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!expense) {
      throw new NotFoundException(`Gasto ${id} no encontrado`);
    }
    return expense;
  }

  async create(input: CreateExpenseInput): Promise<Expense> {
    const expense = this.expensesRepository.create(input);
    const saved = await this.expensesRepository.save(expense);
    return this.findOne(saved.id);
  }

  async update(input: UpdateExpenseInput): Promise<Expense> {
    const expense = await this.findOne(input.id);
    const { id, ...changes } = input;
    Object.assign(expense, changes);
    await this.expensesRepository.save(expense);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const expense = await this.findOne(id);
    await this.expensesRepository.remove(expense);
    return true;
  }
}

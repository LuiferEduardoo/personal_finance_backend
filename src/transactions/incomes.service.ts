import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { CreateIncomeInput } from './dto/create-income.input';
import { TransactionsFilterInput } from './dto/transactions-filter.input';
import { UpdateIncomeInput } from './dto/update-income.input';
import { Income } from './entities/income.entity';

@Injectable()
export class IncomesService {
  constructor(
    @InjectRepository(Income)
    private readonly incomesRepository: Repository<Income>,
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
    if (filter?.paymentMethodId) {
      where.paymentMethodId = filter.paymentMethodId;
    }
    return this.incomesRepository.find({
      where,
      relations: { category: true },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Income> {
    const income = await this.incomesRepository.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!income) {
      throw new NotFoundException(`Ingreso ${id} no encontrado`);
    }
    return income;
  }

  async create(input: CreateIncomeInput): Promise<Income> {
    const income = this.incomesRepository.create(input);
    const saved = await this.incomesRepository.save(income);
    return this.findOne(saved.id);
  }

  async update(input: UpdateIncomeInput): Promise<Income> {
    const income = await this.findOne(input.id);
    const { id, ...changes } = input;
    Object.assign(income, changes);
    await this.incomesRepository.save(income);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const income = await this.findOne(id);
    await this.incomesRepository.remove(income);
    return true;
  }
}

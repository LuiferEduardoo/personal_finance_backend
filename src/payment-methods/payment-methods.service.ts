import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateAccountInput } from './dto/create-account.input';
import { UpdateAccountInput } from './dto/update-account.input';
import { PaymentMethod } from './entities/payment-method.entity';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly accountsRepository: Repository<PaymentMethod>,
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
    const account = this.accountsRepository.create({ ...input, userId });
    return this.accountsRepository.save(account);
  }

  async update(
    userId: string,
    input: UpdateAccountInput,
  ): Promise<PaymentMethod> {
    const account = await this.findOne(input.id, userId);
    const { id, ...changes } = input;
    Object.assign(account, changes);
    await this.accountsRepository.save(account);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const account = await this.findOne(id, userId);
    try {
      await this.accountsRepository.remove(account);
    } catch (error) {
      // installment_plans referencia la cuenta con ON DELETE RESTRICT
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(
          'No se puede borrar la cuenta: tiene planes de cuotas asociados',
        );
      }
      throw error;
    }
    return true;
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { assertCurrency } from '../common/currency';
import {
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
} from './dto/investment-account.input';
import { InvestmentAccount } from './entities/investment-account.entity';
import { InvestmentCashBalance } from './entities/investment-cash-balance.entity';

@Injectable()
export class InvestmentAccountsService {
  constructor(
    @InjectRepository(InvestmentAccount)
    private readonly accountsRepository: Repository<InvestmentAccount>,
    @InjectRepository(InvestmentCashBalance)
    private readonly cashRepository: Repository<InvestmentCashBalance>,
  ) {}

  findAll(
    userId: string,
    includeInactive = false,
  ): Promise<InvestmentAccount[]> {
    return this.accountsRepository.find({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, userId: string): Promise<InvestmentAccount> {
    const account = await this.accountsRepository.findOne({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException(`Cuenta de inversión ${id} no encontrada`);
    }
    return account;
  }

  // valida propiedad antes de dejar que una operación toque la cuenta
  async assertOwned(
    accountId: string | null | undefined,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (!accountId) {
      return;
    }
    const repository =
      manager?.getRepository(InvestmentAccount) ?? this.accountsRepository;
    const found = await repository.findOne({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(
        `Cuenta de inversión ${accountId} no encontrada`,
      );
    }
  }

  create(
    userId: string,
    input: CreateInvestmentAccountInput,
  ): Promise<InvestmentAccount> {
    const account = this.accountsRepository.create({
      ...input,
      userId,
      currency: assertCurrency(input.currency ?? 'USD'),
    });
    return this.accountsRepository.save(account);
  }

  async update(
    userId: string,
    input: UpdateInvestmentAccountInput,
  ): Promise<InvestmentAccount> {
    const account = await this.findOne(input.id, userId);
    const { id, currency, ...changes } = input;
    if (currency !== undefined) {
      account.currency = assertCurrency(currency);
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
      // investment_transactions referencia con ON DELETE CASCADE, pero los
      // lotes apuntan a instrumentos con RESTRICT: si algo bloquea, avisamos
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(
          'No se puede borrar la cuenta: tiene operaciones o lotes asociados',
        );
      }
      throw error;
    }
    return true;
  }

  // saldos de efectivo por moneda; una cuenta de bróker sostiene varias a la vez
  async findCashBalances(
    userId: string,
    accountId?: string,
  ): Promise<InvestmentCashBalance[]> {
    const accounts = await this.accountsRepository.find({
      where: { userId, ...(accountId ? { id: accountId } : {}) },
      select: { id: true },
    });
    if (accounts.length === 0) {
      return [];
    }
    return this.cashRepository
      .createQueryBuilder('cash')
      .where('cash.account_id IN (:...ids)', {
        ids: accounts.map((account) => account.id),
      })
      .orderBy('cash.currency', 'ASC')
      .getMany();
  }
}

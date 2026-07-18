import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TransactionKind } from '../common/enums/transaction-kind.enum';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  // categorías del sistema (userId null) + las propias del usuario
  findAll(userId: string, kind?: TransactionKind): Promise<Category[]> {
    const kindFilter = kind ? { kind } : {};
    return this.categoriesRepository.find({
      where: [
        { userId: IsNull(), isActive: true, ...kindFilter },
        { userId, isActive: true, ...kindFilter },
      ],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    return category;
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    if (input.parentId) {
      await this.validateParent(input.parentId, input.userId, input.kind);
    }
    const category = this.categoriesRepository.create(input);
    return this.categoriesRepository.save(category);
  }

  async update(input: UpdateCategoryInput): Promise<Category> {
    const category = await this.findOne(input.id);
    if (!category.userId) {
      throw new BadRequestException(
        'Las categorías del sistema no se pueden modificar',
      );
    }
    if (input.parentId) {
      await this.validateParent(
        input.parentId,
        category.userId,
        input.kind ?? category.kind,
      );
    }
    const { id, ...changes } = input;
    Object.assign(category, changes);
    return this.categoriesRepository.save(category);
  }

  async remove(id: string): Promise<boolean> {
    const category = await this.findOne(id);
    if (!category.userId) {
      throw new BadRequestException(
        'Las categorías del sistema no se pueden eliminar',
      );
    }
    await this.categoriesRepository.remove(category);
    return true;
  }

  private async validateParent(
    parentId: string,
    userId: string,
    kind: TransactionKind,
  ): Promise<void> {
    const parent = await this.categoriesRepository.findOne({
      where: { id: parentId },
    });
    if (!parent) {
      throw new NotFoundException(`Categoría padre ${parentId} no encontrada`);
    }
    if (parent.userId && parent.userId !== userId) {
      throw new BadRequestException(
        'La categoría padre pertenece a otro usuario',
      );
    }
    if (parent.kind !== kind) {
      throw new BadRequestException(
        'La categoría padre es de otro tipo (expense/income)',
      );
    }
  }
}

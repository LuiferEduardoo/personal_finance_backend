import { registerEnumType } from '@nestjs/graphql';

export enum UnitOfMeasure {
  UNIT = 'unit',
  GRAM = 'g',
  KILOGRAM = 'kg',
  MILLILITER = 'ml',
  LITER = 'l',
  PACK = 'pack',
  ROLL = 'roll',
  PAIR = 'pair',
  OTHER = 'other',
}

registerEnumType(UnitOfMeasure, { name: 'UnitOfMeasure' });

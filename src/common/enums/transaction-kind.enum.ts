import { registerEnumType } from '@nestjs/graphql';

export enum TransactionKind {
  EXPENSE = 'expense',
  INCOME = 'income',
}

registerEnumType(TransactionKind, { name: 'TransactionKind' });

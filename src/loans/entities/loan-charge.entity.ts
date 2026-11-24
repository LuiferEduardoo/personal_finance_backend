import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  Field,
  Float,
  ID,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { Loan } from './loan.entity';

export enum LoanChargeKind {
  INSURANCE = 'insurance',
  FEE = 'fee',
}

export enum LoanChargeMode {
  FIXED = 'fixed',
  PERCENT_OF_BALANCE = 'percent_of_balance',
}

registerEnumType(LoanChargeKind, { name: 'LoanChargeKind' });
registerEnumType(LoanChargeMode, {
  name: 'LoanChargeMode',
  valuesMap: {
    FIXED: { description: 'Valor fijo en dinero por cuota' },
    PERCENT_OF_BALANCE: {
      description:
        'Fracción mensual sobre el saldo de capital al inicio del periodo (p. ej. seguro de vida deudor)',
    },
  },
});

// seguro o comisión que se suma a cada cuota del crédito
@ObjectType({ description: 'Seguro o comisión de un crédito' })
@Entity('loan_charges')
@Check('loan_charges_value_check', '"value" >= 0')
@Index('idx_loan_charges_loan', ['loanId'])
export class LoanCharge {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_loan_charges',
  })
  id: string;

  @ManyToOne(() => Loan, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'loan_id',
    foreignKeyConstraintName: 'FK_loan_charges_loan',
  })
  loan: Loan;

  @Field(() => ID)
  @Column({ name: 'loan_id', type: 'uuid' })
  loanId: string;

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field(() => LoanChargeKind)
  @Column({ type: 'enum', enum: LoanChargeKind, enumName: 'loan_charge_kind' })
  kind: LoanChargeKind;

  @Field(() => LoanChargeMode)
  @Column({ type: 'enum', enum: LoanChargeMode, enumName: 'loan_charge_mode' })
  mode: LoanChargeMode;

  @Field(() => Float, {
    description:
      'FIXED: dinero por cuota; PERCENT_OF_BALANCE: fracción mensual (0.001 = 0.1%)',
  })
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  value: number;
}

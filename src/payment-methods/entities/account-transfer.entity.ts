import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { User } from '../../users/entities/user.entity';
import { PaymentMethod } from './payment-method.entity';

// transferencia de saldo entre dos cuentas del usuario.
// transferir a una cuenta de crédito equivale a pagar la tarjeta.
@ObjectType()
@Entity('account_transfers')
@Check('account_transfers_amount_check', '"amount" > 0')
@Check(
  'account_transfers_distinct_check',
  '"from_account_id" <> "to_account_id"',
)
export class AccountTransfer {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => PaymentMethod)
  @ManyToOne(() => PaymentMethod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'from_account_id' })
  fromAccount: PaymentMethod;

  @Field(() => ID)
  @Index('idx_account_transfers_from')
  @Column({ name: 'from_account_id', type: 'uuid' })
  fromAccountId: string;

  @Field(() => PaymentMethod)
  @ManyToOne(() => PaymentMethod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'to_account_id' })
  toAccount: PaymentMethod;

  @Field(() => ID)
  @Index('idx_account_transfers_to')
  @Column({ name: 'to_account_id', type: 'uuid' })
  toAccountId: string;

  @Field(() => Float)
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: new NumericTransformer(),
  })
  amount: number;

  @Field()
  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

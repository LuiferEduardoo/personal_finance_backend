import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { User } from '../../users/entities/user.entity';

// Cuenta en un bróker o exchange. Es distinta de payment_methods: aquí no hay
// un saldo único sino uno por moneda (investment_cash_balances), porque una
// cuenta de bróker sostiene USD, EUR y USDT a la vez.
@ObjectType()
@Entity('investment_accounts')
@Index('idx_investment_accounts_user', ['userId'], { where: '"is_active"' })
@Index(
  'idx_investment_accounts_external',
  ['userId', 'connectionId', 'externalAccountId'],
  {
    unique: true,
    where: '"external_account_id" IS NOT NULL',
  },
)
export class InvestmentAccount {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // se llena en la fase de conectores. ON DELETE SET NULL: borrar una conexión
  // jamás debe borrar el histórico de operaciones.
  @Field(() => ID, { nullable: true })
  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId: string | null;

  // desnormalizado para que una cuenta manual funcione sin conexión
  @Field(() => BrokerKind)
  @Column({
    type: 'enum',
    enum: BrokerKind,
    enumName: 'broker_kind',
    default: BrokerKind.MANUAL,
  })
  broker: BrokerKind;

  @Field(() => String, { nullable: true })
  @Column({ name: 'external_account_id', type: 'text', nullable: true })
  externalAccountId: string | null;

  @Field()
  @Column({ type: 'text' })
  name: string;

  @Field({ description: 'Moneda principal de la cuenta' })
  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  // reservado: espejo de depósitos/retiros hacia payment_methods
  @Field(() => ID, { nullable: true })
  @Column({ name: 'linked_payment_method_id', type: 'uuid', nullable: true })
  linkedPaymentMethodId: string | null;

  @Field()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

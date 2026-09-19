import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { User } from '../../users/entities/user.entity';

export enum BrokerConnectionStatus {
  ACTIVE = 'active',
  ERROR = 'error',
  NEEDS_REAUTH = 'needs_reauth',
  DISABLED = 'disabled',
}

registerEnumType(BrokerConnectionStatus, {
  name: 'BrokerConnectionStatus',
  description: 'Estado de una conexión con un bróker',
});

// Conexión con un bróker o exchange.
//
// Las columnas de credenciales NO llevan @Field: GraphQL nunca puede leerlas,
// ni siquiera cifradas. Lo único que se expone es el getter `hasCredentials`.
@ObjectType()
@Entity('broker_connections')
@Unique('broker_connections_label_unique', ['userId', 'broker', 'label'])
export class BrokerConnection {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => BrokerKind)
  @Column({ type: 'enum', enum: BrokerKind, enumName: 'broker_kind' })
  broker: BrokerKind;

  @Field()
  @Column({ type: 'text' })
  label: string;

  @Field({ description: 'Cuenta de práctica del bróker' })
  @Column({ name: 'is_demo', default: false })
  isDemo: boolean;

  @Field({ description: 'Se sincroniza sola en el job nocturno' })
  @Column({ name: 'auto_sync', default: true })
  autoSync: boolean;

  // --- credenciales cifradas: sin @Field, nunca salen por la API ---

  @Column({ name: 'credentials_ciphertext', type: 'bytea', nullable: true })
  credentialsCiphertext: Buffer | null;

  @Column({ name: 'credentials_iv', type: 'bytea', nullable: true })
  credentialsIv: Buffer | null;

  @Column({ name: 'credentials_tag', type: 'bytea', nullable: true })
  credentialsTag: Buffer | null;

  @Field(() => Int, { description: 'Versión de clave con la que se cifraron' })
  @Column({ name: 'credentials_key_version', type: 'smallint', default: 1 })
  credentialsKeyVersion: number;

  @Field(() => BrokerConnectionStatus)
  @Column({
    type: 'enum',
    enum: BrokerConnectionStatus,
    enumName: 'broker_connection_status',
    default: BrokerConnectionStatus.ACTIVE,
  })
  status: BrokerConnectionStatus;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  // forma definida por cada conector: fecha de corte, fromId por símbolo, etc.
  @Column({ name: 'last_sync_cursor', type: 'jsonb', nullable: true })
  lastSyncCursor: Record<string, unknown> | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Lo ÚNICO que GraphQL puede saber de las credenciales: si las hay.
  @Field({ description: 'Si la conexión tiene credenciales guardadas' })
  get hasCredentials(): boolean {
    return this.credentialsCiphertext !== null;
  }
}

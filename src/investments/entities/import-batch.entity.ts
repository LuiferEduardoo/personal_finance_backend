import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { User } from '../../users/entities/user.entity';

export enum ImportSource {
  CSV = 'csv',
  XLSX = 'xlsx',
  PDF = 'pdf',
  BROKER_SYNC = 'broker_sync',
}

registerEnumType(ImportSource, {
  name: 'ImportSource',
  description: 'De dónde vinieron las operaciones de un lote de importación',
});

export enum ImportStatus {
  PARSED = 'parsed',
  COMMITTED = 'committed',
  FAILED = 'failed',
  DISCARDED = 'discarded',
}

registerEnumType(ImportStatus, {
  name: 'ImportStatus',
  description: 'Estado de un lote de importación',
});

// Lote de importación. Sigue la misma forma que invoice_analyses: el archivo
// crudo se archiva en bytea y el resultado del parser en jsonb, de modo que
// confirmar puede volver a parsear sin pedirle el archivo otra vez al usuario
// (por ejemplo, tras corregir el mapeo de columnas).
//
// No hay tabla de filas: los borradores son efímeros y siempre se leen y
// escriben enteros, igual que invoice_analyses.result.
@ObjectType()
@Entity('import_batches')
@Index('idx_import_batches_user', ['userId', 'createdAt'])
export class ImportBatch {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Field(() => ImportSource)
  @Column({
    type: 'enum',
    enum: ImportSource,
    enumName: 'import_source',
  })
  source: ImportSource;

  @Field(() => ImportStatus)
  @Column({
    type: 'enum',
    enum: ImportStatus,
    enumName: 'import_status',
    default: ImportStatus.PARSED,
  })
  status: ImportStatus;

  @Field(() => BrokerKind, { nullable: true })
  @Column({
    type: 'enum',
    enum: BrokerKind,
    enumName: 'broker_kind',
    nullable: true,
  })
  broker: BrokerKind | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'file_name', type: 'text', nullable: true })
  fileName: string | null;

  // el archivo original, para poder re-parsear con otro mapeo sin volver a
  // pedírselo al usuario
  @Column({ name: 'file_data', type: 'bytea', nullable: true })
  fileData: Buffer | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'file_mime_type', type: 'text', nullable: true })
  fileMimeType: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Perfil de parseo detectado',
  })
  @Column({ name: 'parser_profile', type: 'text', nullable: true })
  parserProfile: string | null;

  @Column({ name: 'column_mapping', type: 'jsonb', nullable: true })
  columnMapping: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  draft: unknown;

  @Column({ type: 'jsonb', nullable: true })
  stats: Record<string, number> | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

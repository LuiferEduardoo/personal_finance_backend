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
import { ApiScope } from '../../common/enums/api-scope.enum';
import { User } from '../../users/entities/user.entity';

// Credencial para acceso externo a la información del usuario. El token
// completo solo existe en la respuesta de createApiKey: aquí se guarda su
// hash y el prefijo público, que sirve para identificarla sin revelarla.
@ObjectType()
@Entity('api_keys')
@Index('idx_api_keys_user', ['userId'])
export class ApiKey {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.apiKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Field(() => ID)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field({ description: 'Nombre para identificarla (ej. "Dashboard Notion")' })
  @Column({ type: 'text' })
  name: string;

  @Field({ description: 'Prefijo público del token (pfk_xxxxxxxxxxxx)' })
  @Index('idx_api_keys_prefix', { unique: true })
  @Column({ type: 'text' })
  prefix: string;

  // sha256 del token completo; nunca se expone en GraphQL
  @Column({ name: 'key_hash', type: 'text' })
  keyHash: string;

  @Field(() => [ApiScope], { description: 'Permisos concedidos' })
  @Column({ type: 'text', array: true })
  scopes: ApiScope[];

  @Field(() => Date, { nullable: true, description: 'Fecha de expiración' })
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

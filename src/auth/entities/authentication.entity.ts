import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
}

export enum TwoFactorMethod {
  TOTP = 'totp',
  EMAIL = 'email',
}

registerEnumType(TwoFactorMethod, { name: 'TwoFactorMethod' });

registerEnumType(AuthProvider, { name: 'AuthProvider' });

@ObjectType()
@Entity('authentications')
export class Authentication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, (user) => user.authentication, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  // null cuando el usuario se registró solo con Google
  @Column({ type: 'varchar', nullable: true, select: false })
  password: string | null;

  @Field(() => AuthProvider)
  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.LOCAL,
  })
  provider: AuthProvider;

  @Index({ unique: true })
  @Column({ name: 'google_id', type: 'varchar', nullable: true })
  googleId: string | null;

  @Field()
  @Column({ name: 'email_verified', default: false })
  emailVerified: boolean;

  @Field(() => TwoFactorMethod, { nullable: true })
  @Column({
    name: 'two_factor_method',
    type: 'enum',
    enum: TwoFactorMethod,
    nullable: true,
  })
  twoFactorMethod: TwoFactorMethod | null;

  @Column({
    name: 'totp_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  totpSecretEncrypted: string | null;

  @Column({
    name: 'pending_totp_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  pendingTotpSecretEncrypted: string | null;

  @Column({
    name: 'verification_code_hash',
    type: 'char',
    length: 64,
    nullable: true,
    select: false,
  })
  verificationCodeHash: string | null;

  @Column({
    name: 'verification_code_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  verificationCodeExpiresAt: Date | null;

  @Column({
    name: 'password_reset_hash',
    type: 'char',
    length: 64,
    nullable: true,
    select: false,
  })
  passwordResetHash: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  passwordResetExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

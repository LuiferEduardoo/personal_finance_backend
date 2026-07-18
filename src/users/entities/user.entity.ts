import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Authentication } from '../../auth/entities/authentication.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToOne(() => Authentication, (authentication) => authentication.user)
  authentication: Authentication;

  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refreshTokens: RefreshToken[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}

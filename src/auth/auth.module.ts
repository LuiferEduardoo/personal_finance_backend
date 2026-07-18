import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { Authentication } from './entities/authentication.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Authentication, RefreshToken]),
    UsersModule,
  ],
  exports: [TypeOrmModule],
})
export class AuthModule {}

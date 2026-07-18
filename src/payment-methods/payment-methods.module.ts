import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentMethod } from './entities/payment-method.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentMethod])],
  exports: [TypeOrmModule],
})
export class PaymentMethodsModule {}

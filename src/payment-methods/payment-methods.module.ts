import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentMethod } from './entities/payment-method.entity';
import { PaymentMethodsResolver } from './payment-methods.resolver';
import { PaymentMethodsService } from './payment-methods.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentMethod])],
  providers: [PaymentMethodsService, PaymentMethodsResolver],
  exports: [TypeOrmModule, PaymentMethodsService],
})
export class PaymentMethodsModule {}

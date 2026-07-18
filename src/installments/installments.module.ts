import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { Installment } from './entities/installment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InstallmentPlan, Installment])],
  exports: [TypeOrmModule],
})
export class InstallmentsModule {}

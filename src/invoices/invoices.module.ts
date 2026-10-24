import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategorizationModule } from '../categorization/categorization.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InvoiceAnalysis } from './entities/invoice-analysis.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

// JwtModule es global (registrado en AuthModule), así que JwtAuthGuard puede
// inyectar JwtService sin importar AuthModule. TransactionsModule aporta
// ExpensesService para crear el gasto ya confirmado y CategorizationModule
// el clasificador de categorías.
@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceAnalysis]),
    TransactionsModule,
    CategorizationModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, JwtAuthGuard],
})
export class InvoicesModule {}

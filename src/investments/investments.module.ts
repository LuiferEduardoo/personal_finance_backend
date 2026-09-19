import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketDataModule } from '../market-data/market-data.module';
import { UsersModule } from '../users/users.module';
import { InvestmentAccount } from './entities/investment-account.entity';
import { InvestmentCashBalance } from './entities/investment-cash-balance.entity';
import { InvestmentLot } from './entities/investment-lot.entity';
import { InvestmentPosition } from './entities/investment-position.entity';
import { InvestmentRealization } from './entities/investment-realization.entity';
import { InvestmentTransaction } from './entities/investment-transaction.entity';
import { InvestmentAccountsResolver } from './investment-accounts.resolver';
import { InvestmentAccountsService } from './investment-accounts.service';
import { InvestmentTransactionsResolver } from './investment-transactions.resolver';
import { InvestmentTransactionsService } from './investment-transactions.service';
import { PortfolioAnalyticsService } from './portfolio-analytics.service';
import { PortfolioResolver } from './portfolio.resolver';
import { PositionsService } from './positions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvestmentAccount,
      InvestmentCashBalance,
      InvestmentTransaction,
      InvestmentLot,
      InvestmentRealization,
      InvestmentPosition,
    ]),
    MarketDataModule,
    UsersModule,
  ],
  providers: [
    InvestmentAccountsService,
    InvestmentAccountsResolver,
    InvestmentTransactionsService,
    InvestmentTransactionsResolver,
    PositionsService,
    PortfolioAnalyticsService,
    PortfolioResolver,
  ],
  exports: [
    TypeOrmModule,
    InvestmentAccountsService,
    InvestmentTransactionsService,
    PositionsService,
    PortfolioAnalyticsService,
  ],
})
export class InvestmentsModule {}

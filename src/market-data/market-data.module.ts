import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FxRate } from './entities/fx-rate.entity';
import { InstrumentPrice } from './entities/instrument-price.entity';
import { Instrument } from './entities/instrument.entity';
import { MarketDataUsage } from './entities/market-data-usage.entity';
import { FxService } from './fx.service';
import { InstrumentsResolver } from './instruments.resolver';
import { InstrumentsService } from './instruments.service';
import { MarketDataCron } from './market-data.cron';
import { PricesService } from './prices.service';
import {
  MarketDataRateLimiter,
  PostgresUsageCounterStore,
  USAGE_COUNTER_STORE,
} from './rate-limiter.service';
import { TwelveDataClient } from './twelve-data.client';

// Datos de referencia GLOBALES (sin user_id). InvestmentsModule importa este
// módulo; nunca al revés.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Instrument,
      InstrumentPrice,
      FxRate,
      MarketDataUsage,
    ]),
  ],
  providers: [
    InstrumentsService,
    InstrumentsResolver,
    TwelveDataClient,
    PostgresUsageCounterStore,
    { provide: USAGE_COUNTER_STORE, useExisting: PostgresUsageCounterStore },
    MarketDataRateLimiter,
    PricesService,
    FxService,
    MarketDataCron,
  ],
  exports: [
    TypeOrmModule,
    InstrumentsService,
    PricesService,
    FxService,
    MarketDataRateLimiter,
    TwelveDataClient,
  ],
})
export class MarketDataModule {}

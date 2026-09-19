import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstrumentPrice } from './entities/instrument-price.entity';
import { Instrument } from './entities/instrument.entity';
import { InstrumentsResolver } from './instruments.resolver';
import { InstrumentsService } from './instruments.service';

// Datos de referencia GLOBALES (sin user_id). InvestmentsModule importa este
// módulo; nunca al revés.
@Module({
  imports: [TypeOrmModule.forFeature([Instrument, InstrumentPrice])],
  providers: [InstrumentsService, InstrumentsResolver],
  exports: [TypeOrmModule, InstrumentsService],
})
export class MarketDataModule {}

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { InstrumentPriceSource } from './instrument.entity';

// Tasa de cambio diaria entre dos monedas. Global, sin user_id: la tasa
// USD/COP de un día es la misma para todo el mundo.
//
// La escala 10 no es capricho: USD/COP ~ 4100 y COP/USD ~ 0.000244 tienen que
// caber ambas en la misma columna sin perder precisión al invertir.
@Entity('fx_rates')
export class FxRate {
  @PrimaryColumn({ name: 'base_currency', type: 'char', length: 3 })
  baseCurrency: string;

  @PrimaryColumn({ name: 'quote_currency', type: 'char', length: 3 })
  quoteCurrency: string;

  @PrimaryColumn({ name: 'rate_on', type: 'date' })
  rateOn: string;

  // 1 unidad de baseCurrency = `rate` unidades de quoteCurrency
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  rate: number;

  @Column({
    type: 'enum',
    enum: InstrumentPriceSource,
    enumName: 'instrument_price_source',
    default: InstrumentPriceSource.TWELVE_DATA,
  })
  source: InstrumentPriceSource;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

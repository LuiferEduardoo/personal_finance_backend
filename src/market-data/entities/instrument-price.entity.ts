import { Column, Entity, PrimaryColumn } from 'typeorm';
import { NumericTransformer } from '../../common/transformers/numeric.transformer';
import { InstrumentPriceSource } from './instrument.entity';

// Cierre diario de un instrumento. NO es @ObjectType: se expone a través de
// DTOs, nunca directo.
//
// Desviación deliberada de la convención "id uuid" del repo: esta tabla es un
// caché de alta cardinalidad cuya clave natural ES su identidad. La PK
// compuesta da upsert con ON CONFLICT gratis y un índice perfecto para los
// rangos de fechas que pide ensureHistory().
@Entity('instrument_prices')
export class InstrumentPrice {
  @PrimaryColumn({ name: 'instrument_id', type: 'uuid' })
  instrumentId: string;

  @PrimaryColumn({ name: 'price_on', type: 'date' })
  priceOn: string;

  // cierre crudo: es el que se usa para valorar la cartera, porque nuestras
  // propias filas SPLIT ya ajustaron la cantidad.
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 10,
    transformer: new NumericTransformer(),
  })
  close: number;

  // cierre ajustado por dividendos y splits: solo para los benchmarks, donde
  // hace de proxy de retorno total comparable con el TWR del usuario.
  @Column({
    name: 'adjusted_close',
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
    transformer: new NumericTransformer(),
  })
  adjustedClose: number | null;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: InstrumentPriceSource,
    enumName: 'instrument_price_source',
    default: InstrumentPriceSource.TWELVE_DATA,
  })
  source: InstrumentPriceSource;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  createdAt: Date;
}

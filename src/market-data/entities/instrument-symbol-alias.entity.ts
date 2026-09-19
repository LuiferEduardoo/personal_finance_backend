import { Column, Entity, PrimaryColumn } from 'typeorm';

// Cómo llama cada bróker a un instrumento nuestro.
//
// Mata para siempre el gasto repetido en /symbol_search: un string de bróker
// se resuelve UNA vez y a partir de ahí sale del caché. Global, sin user_id,
// porque "AAPL.US" en eToro es el mismo Apple para todo el mundo.
@Entity('instrument_symbol_aliases')
export class InstrumentSymbolAlias {
  // 'etoro' | 'ibkr' | 'binance' | 'xtb' | 'user' | 'twelve_data'
  @PrimaryColumn({ type: 'text' })
  source: string;

  @PrimaryColumn({ type: 'text' })
  alias: string;

  @Column({ name: 'instrument_id', type: 'uuid' })
  instrumentId: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

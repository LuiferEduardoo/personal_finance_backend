import { Column, Entity, PrimaryColumn } from 'typeorm';

// Consumo de créditos del proveedor de precios, por minuto.
//
// Es la mitad DURABLE del limitador: un reinicio, una segunda instancia o una
// caída a mitad del job no pueden reventar la cuota diaria, porque el contador
// no vive en memoria. Se incrementa con un INSERT ... ON CONFLICT DO UPDATE
// atómico antes de cada llamada.
@Entity('market_data_usage')
export class MarketDataUsage {
  @PrimaryColumn({ type: 'text' })
  provider: string;

  // truncado al minuto: date_trunc('minute', now())
  @PrimaryColumn({ name: 'window_minute', type: 'timestamptz' })
  windowMinute: Date;

  @Column({ type: 'int', default: 0 })
  credits: number;
}

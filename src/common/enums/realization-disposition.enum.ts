import { registerEnumType } from '@nestjs/graphql';

// Motivo por el que se cerró la posición de un lote. Vive en common/enums y no
// en la entidad porque lo comparte el reductor puro de
// src/investments/analytics/portfolio-ledger.ts, que no puede importar
// entidades de TypeORM.
export enum RealizationDisposition {
  SALE = 'sale',
  TRANSFER_OUT = 'transfer_out',
}

registerEnumType(RealizationDisposition, {
  name: 'RealizationDisposition',
  description: 'Motivo por el que se cerró la posición del lote',
});

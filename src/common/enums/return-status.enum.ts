import { registerEnumType } from '@nestjs/graphql';

// Estados de los cálculos de rentabilidad. Viven aquí y no junto a su
// algoritmo porque los módulos de src/investments/analytics/ son PUROS: no
// importan Nest ni TypeORM, y eso es lo que los hace testeables sin
// infraestructura.

export enum AnnualizedStatus {
  OK = 'ok',
  /** Menos de 365 días: anualizar daría un número sin sentido */
  PERIOD_TOO_SHORT = 'period_too_short',
  /** No hay base positiva sobre la que medir */
  NO_BASE = 'no_base',
}

registerEnumType(AnnualizedStatus, {
  name: 'AnnualizedStatus',
  description: 'Por qué una rentabilidad anualizada puede venir vacía',
});

export enum XirrStatus {
  OK = 'ok',
  /** Menos de dos flujos, o todos el mismo día */
  NOT_ENOUGH_FLOWS = 'not_enough_flows',
  /** Solo aportes y ningún valor: la función no cruza cero */
  NO_SIGN_CHANGE = 'no_sign_change',
  /** Ni Newton-Raphson ni la bisección encontraron la raíz */
  DID_NOT_CONVERGE = 'did_not_converge',
}

registerEnumType(XirrStatus, {
  name: 'XirrStatus',
  description: 'Resultado del cálculo de XIRR',
});

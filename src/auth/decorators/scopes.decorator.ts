import { SetMetadata } from '@nestjs/common';
import { ApiScope } from '../../common/enums/api-scope.enum';

export const SCOPES_KEY = 'api_scopes';

/**
 * Scopes que una API key necesita para ejecutar la operación. El JWT de un
 * usuario siempre pasa: los scopes solo limitan a las API keys.
 *
 * Una operación SIN @Scopes queda cerrada a las API keys (fail closed): así
 * nada nuevo queda expuesto por olvido.
 */
export const Scopes = (...scopes: ApiScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);

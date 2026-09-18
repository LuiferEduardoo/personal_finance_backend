import { ApiScope } from '../common/enums/api-scope.enum';
import { JwtPayload } from './auth.service';

export enum PrincipalKind {
  USER = 'user',
  API_KEY = 'api-key',
}

// Quien ejecuta la petición. Un usuario autenticado con JWT tiene acceso
// total a sus datos; una API key solo a los scopes que se le concedieron.
// Extiende JwtPayload para que los resolvers existentes sigan leyendo `sub`.
export interface Principal extends JwtPayload {
  kind: PrincipalKind;
  scopes: ApiScope[];
  apiKeyId?: string;
}

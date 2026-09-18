import { Field, InputType } from '@nestjs/graphql';
import { ApiScope } from '../../common/enums/api-scope.enum';

@InputType()
export class CreateApiKeyInput {
  @Field({ description: 'Nombre para identificarla (ej. "Dashboard Notion")' })
  name: string;

  @Field(() => [ApiScope], {
    description:
      'Permisos concedidos. Usa [ALL] para acceso total o la lista específica',
  })
  scopes: ApiScope[];

  @Field(() => Date, {
    nullable: true,
    description: 'Fecha de expiración; sin ella la key no caduca',
  })
  expiresAt?: Date;
}

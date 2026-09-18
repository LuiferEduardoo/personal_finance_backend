import { Field, ObjectType } from '@nestjs/graphql';
import { ApiKey } from '../entities/api-key.entity';

@ObjectType()
export class ApiKeyCreated {
  @Field(() => ApiKey)
  apiKey: ApiKey;

  @Field({
    description:
      'Token completo. Solo se devuelve aquí: no se puede volver a consultar',
  })
  token: string;
}

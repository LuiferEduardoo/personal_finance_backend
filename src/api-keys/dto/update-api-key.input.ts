import { Field, ID, InputType } from '@nestjs/graphql';
import { ApiScope } from '../../common/enums/api-scope.enum';

@InputType()
export class UpdateApiKeyInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field(() => [ApiScope], {
    nullable: true,
    description: 'Reemplaza los permisos concedidos',
  })
  scopes?: ApiScope[];

  @Field(() => Date, { nullable: true })
  expiresAt?: Date;
}

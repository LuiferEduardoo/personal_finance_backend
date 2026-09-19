import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class LoginInput {
  @Field()
  email: string;

  @Field()
  password: string;

  @Field({ nullable: true, description: 'Código TOTP o recibido por correo' })
  twoFactorCode?: string;
}

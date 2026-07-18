import { Field, ObjectType } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';

@ObjectType()
export class AuthPayload {
  @Field({ description: 'JWT de acceso (20 minutos)' })
  accessToken: string;

  @Field({ description: 'Refresh token opaco (6 meses)' })
  refreshToken: string;

  @Field(() => User)
  user: User;
}

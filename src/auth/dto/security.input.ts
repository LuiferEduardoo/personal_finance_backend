import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { TwoFactorMethod } from '../entities/authentication.entity';

@InputType()
export class ChangePasswordInput {
  @Field() currentPassword: string;
  @Field() newPassword: string;
}

@InputType()
export class ResetPasswordInput {
  @Field() token: string;
  @Field() newPassword: string;
}

@ObjectType()
export class TwoFactorSetup {
  @Field(() => TwoFactorMethod) method: TwoFactorMethod;
  @Field({ nullable: true }) secret: string | null;
  @Field({ nullable: true }) otpauthUri: string | null;
}

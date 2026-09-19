import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthSecurity1789835000000 implements MigrationInterface {
  name = 'AuthSecurity1789835000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "two_factor_method" AS ENUM('totp', 'email')`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "two_factor_method" "two_factor_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "totp_secret_encrypted" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "verification_code_hash" char(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "verification_code_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "password_reset_hash" char(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "password_reset_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" ADD "last_payment_reminder_on" date`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_methods" DROP COLUMN "last_payment_reminder_on"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "password_reset_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "password_reset_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "verification_code_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "verification_code_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "totp_secret_encrypted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "two_factor_method"`,
    );
    await queryRunner.query(`DROP TYPE "two_factor_method"`);
  }
}

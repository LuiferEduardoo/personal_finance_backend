import { MigrationInterface, QueryRunner } from 'typeorm';

export class PendingTotpSecret1789836000000 implements MigrationInterface {
  name = 'PendingTotpSecret1789836000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "authentications" ADD "pending_totp_secret_encrypted" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "authentications" DROP COLUMN "pending_totp_secret_encrypted"`,
    );
  }
}

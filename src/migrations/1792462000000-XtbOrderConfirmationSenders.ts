import { MigrationInterface, QueryRunner } from 'typeorm';

// Remitentes de confirmaciones de órdenes de XTB: tipo de remitente (los que ya
// existen quedan como facturas), cuenta de inversión destino y contraseña de
// los PDF cifrada. La bitácora guarda cuántas operaciones registró cada correo.
export class XtbOrderConfirmationSenders1792462000000 implements MigrationInterface {
  name = 'XtbOrderConfirmationSenders1792462000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "mail_sender_kind" AS ENUM('invoice', 'xtb_order_confirmation')`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "kind" "mail_sender_kind" NOT NULL DEFAULT 'invoice'`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "investment_account_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "attachment_password_ciphertext" bytea`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "attachment_password_iv" bytea`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "attachment_password_tag" bytea`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD "attachment_password_key_version" smallint NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD CONSTRAINT "FK_mail_senders_investment_account" FOREIGN KEY ("investment_account_id") REFERENCES "investment_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" ADD "operations_recorded" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mail_messages" DROP COLUMN "operations_recorded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP CONSTRAINT "FK_mail_senders_investment_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP COLUMN "attachment_password_key_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP COLUMN "attachment_password_tag"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP COLUMN "attachment_password_iv"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP COLUMN "attachment_password_ciphertext"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP COLUMN "investment_account_id"`,
    );
    await queryRunner.query(`ALTER TABLE "mail_senders" DROP COLUMN "kind"`);
    await queryRunner.query(`DROP TYPE "mail_sender_kind"`);
  }
}

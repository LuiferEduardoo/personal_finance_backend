import { MigrationInterface, QueryRunner } from 'typeorm';

// Lectura de facturas electrónicas desde el correo: buzón conectado,
// remitentes configurados, bitácora de correos procesados y facturas
// registradas (únicas por CUFE).
export class MailInvoices1790396947283 implements MigrationInterface {
  name = 'MailInvoices1790396947283';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "mail_provider" AS ENUM('gmail')`);
    await queryRunner.query(
      `CREATE TYPE "mail_connection_status" AS ENUM('active', 'error', 'needs_reauth', 'disabled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mail_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "provider" "mail_provider" NOT NULL DEFAULT 'gmail', "email_address" text NOT NULL, "token_ciphertext" bytea, "token_iv" bytea, "token_tag" bytea, "token_key_version" smallint NOT NULL DEFAULT '1', "status" "mail_connection_status" NOT NULL DEFAULT 'active', "history_id" text, "watch_expires_at" TIMESTAMP WITH TIME ZONE, "last_synced_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "mail_connections_email_unique" UNIQUE ("user_id", "email_address"), CONSTRAINT "PK_mail_connections" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "mail_backfill_status" AS ENUM('idle', 'running', 'done', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mail_senders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "connection_id" uuid NOT NULL, "email_address" text NOT NULL, "merchant_name" text NOT NULL, "default_account_id" uuid, "default_category_id" uuid, "active" boolean NOT NULL DEFAULT true, "backfill_from" date, "backfill_status" "mail_backfill_status" NOT NULL DEFAULT 'idle', "backfill_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "mail_senders_email_unique" UNIQUE ("connection_id", "email_address"), CONSTRAINT "PK_mail_senders" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "mail_message_status" AS ENUM('processing', 'registered', 'duplicate', 'no_invoice', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mail_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "connection_id" uuid NOT NULL, "gmail_message_id" text NOT NULL, "sender_id" uuid, "subject" text, "received_at" TIMESTAMP WITH TIME ZONE, "status" "mail_message_status" NOT NULL DEFAULT 'processing', "error" text, "expense_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "mail_messages_gmail_unique" UNIQUE ("connection_id", "gmail_message_id"), CONSTRAINT "PK_mail_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_mail_messages_user_status" ON "mail_messages" ("user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "mail_invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "cufe" text NOT NULL, "invoice_number" text NOT NULL, "issuer_nit" text, "issuer_name" text NOT NULL, "issue_date" date NOT NULL, "total" numeric(14,2) NOT NULL, "currency" character(3) NOT NULL, "mail_message_id" uuid, "expense_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "mail_invoices_cufe_unique" UNIQUE ("user_id", "cufe"), CONSTRAINT "PK_mail_invoices" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_connections" ADD CONSTRAINT "FK_mail_connections_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD CONSTRAINT "FK_mail_senders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD CONSTRAINT "FK_mail_senders_connection" FOREIGN KEY ("connection_id") REFERENCES "mail_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD CONSTRAINT "FK_mail_senders_account" FOREIGN KEY ("default_account_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" ADD CONSTRAINT "FK_mail_senders_category" FOREIGN KEY ("default_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" ADD CONSTRAINT "FK_mail_messages_connection" FOREIGN KEY ("connection_id") REFERENCES "mail_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" ADD CONSTRAINT "FK_mail_messages_sender" FOREIGN KEY ("sender_id") REFERENCES "mail_senders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" ADD CONSTRAINT "FK_mail_messages_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" ADD CONSTRAINT "FK_mail_invoices_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" ADD CONSTRAINT "FK_mail_invoices_message" FOREIGN KEY ("mail_message_id") REFERENCES "mail_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" ADD CONSTRAINT "FK_mail_invoices_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" DROP CONSTRAINT "FK_mail_invoices_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" DROP CONSTRAINT "FK_mail_invoices_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_invoices" DROP CONSTRAINT "FK_mail_invoices_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_mail_messages_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_mail_messages_sender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_mail_messages_connection"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP CONSTRAINT "FK_mail_senders_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP CONSTRAINT "FK_mail_senders_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP CONSTRAINT "FK_mail_senders_connection"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_senders" DROP CONSTRAINT "FK_mail_senders_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_connections" DROP CONSTRAINT "FK_mail_connections_user"`,
    );
    await queryRunner.query(`DROP TABLE "mail_invoices"`);
    await queryRunner.query(`DROP INDEX "idx_mail_messages_user_status"`);
    await queryRunner.query(`DROP TABLE "mail_messages"`);
    await queryRunner.query(`DROP TYPE "mail_message_status"`);
    await queryRunner.query(`DROP TABLE "mail_senders"`);
    await queryRunner.query(`DROP TYPE "mail_backfill_status"`);
    await queryRunner.query(`DROP TABLE "mail_connections"`);
    await queryRunner.query(`DROP TYPE "mail_connection_status"`);
    await queryRunner.query(`DROP TYPE "mail_provider"`);
  }
}

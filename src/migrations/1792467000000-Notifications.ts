import { MigrationInterface, QueryRunner } from 'typeorm';

// Notificaciones dentro de la app. La clave de deduplicación es única por
// usuario: los productores insertan con ON CONFLICT DO NOTHING.
export class Notifications1792467000000 implements MigrationInterface {
  name = 'Notifications1792467000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM('budget_near', 'budget_exceeded', 'loan_installment_due', 'loan_installment_overdue', 'mail_message_failed', 'recurring_expenses_generated')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" "notification_type" NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "link" text, "dedupe_key" text NOT NULL, "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "notifications_dedupe_unique" UNIQUE ("user_id", "dedupe_key"), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_read" ON "notifications" ("user_id", "read_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_notifications_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_notifications_user_read"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "notification_type"`);
  }
}

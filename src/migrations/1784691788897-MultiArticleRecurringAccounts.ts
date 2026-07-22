import { MigrationInterface, QueryRunner } from "typeorm";

export class MultiArticleRecurringAccounts1784691788897 implements MigrationInterface {
    name = 'MultiArticleRecurringAccounts1784691788897'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_9bc64250e32eb71316dd0cd8197"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expenses_article"`);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["personal_finance","public","expense_items","GENERATED_COLUMN","subtotal","\"unit_price\" * \"quantity\""]);
        await queryRunner.query(`CREATE TABLE "expense_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "expense_id" uuid NOT NULL, "article_id" uuid, "description" text, "unit_price" numeric(14,2) NOT NULL, "quantity" numeric(12,3) NOT NULL DEFAULT '1', "subtotal" numeric(14,2) GENERATED ALWAYS AS ("unit_price" * "quantity") STORED NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "expense_items_quantity_check" CHECK ("quantity" > 0), CONSTRAINT "expense_items_unit_price_check" CHECK ("unit_price" >= 0), CONSTRAINT "PK_6fd381fa4fa54678572a7aa534d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_expense_items_expense" ON "expense_items" ("expense_id") `);
        await queryRunner.query(`CREATE INDEX "idx_expense_items_article" ON "expense_items" ("article_id") `);
        await queryRunner.query(`CREATE TABLE "recurring_expense_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recurring_expense_id" uuid NOT NULL, "article_id" uuid, "description" text, "unit_price" numeric(14,2) NOT NULL, "quantity" numeric(12,3) NOT NULL DEFAULT '1', CONSTRAINT "recurring_expense_items_quantity_check" CHECK ("quantity" > 0), CONSTRAINT "recurring_expense_items_unit_price_check" CHECK ("unit_price" >= 0), CONSTRAINT "PK_a5d62af0e203c9db6e9da7cf902" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "recurring_expenses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "description" text NOT NULL, "category_id" uuid, "payment_method_id" uuid, "amount" numeric(14,2), "currency" character(3) NOT NULL DEFAULT 'COP', "exchange_rate" numeric(14,6) NOT NULL DEFAULT '1', "merchant" text, "notes" text, "recurrence" "public"."recurrence" NOT NULL, "start_on" date NOT NULL, "next_run_on" date NOT NULL, "end_on" date, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_592b47923f3bdb6035439182e66" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_recurring_expenses_due" ON "recurring_expenses" ("next_run_on") WHERE "is_active"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "article_id"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "quantity"`);
        await queryRunner.query(`ALTER TABLE "expense_items" ADD CONSTRAINT "FK_0ce51d6048f5679b3c53194ba06" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_items" ADD CONSTRAINT "FK_1e490b0964eb67ce5d91c07fd60" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recurring_expense_items" ADD CONSTRAINT "FK_d931b40a69cffa95fb7ecd695ef" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recurring_expense_items" ADD CONSTRAINT "FK_01bb073f89fe10912ee4ca69a80" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_fcf7bed1a32dd2d93a8b32f05bd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_6c283ae62cbde91625a20e9ccbd" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_d4af1ea19463a1358b95921e535" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recurring_expenses" DROP CONSTRAINT "FK_d4af1ea19463a1358b95921e535"`);
        await queryRunner.query(`ALTER TABLE "recurring_expenses" DROP CONSTRAINT "FK_6c283ae62cbde91625a20e9ccbd"`);
        await queryRunner.query(`ALTER TABLE "recurring_expenses" DROP CONSTRAINT "FK_fcf7bed1a32dd2d93a8b32f05bd"`);
        await queryRunner.query(`ALTER TABLE "recurring_expense_items" DROP CONSTRAINT "FK_01bb073f89fe10912ee4ca69a80"`);
        await queryRunner.query(`ALTER TABLE "recurring_expense_items" DROP CONSTRAINT "FK_d931b40a69cffa95fb7ecd695ef"`);
        await queryRunner.query(`ALTER TABLE "expense_items" DROP CONSTRAINT "FK_1e490b0964eb67ce5d91c07fd60"`);
        await queryRunner.query(`ALTER TABLE "expense_items" DROP CONSTRAINT "FK_0ce51d6048f5679b3c53194ba06"`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD "quantity" numeric(12,3) NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD "article_id" uuid`);
        await queryRunner.query(`DROP INDEX "public"."idx_recurring_expenses_due"`);
        await queryRunner.query(`DROP TABLE "recurring_expenses"`);
        await queryRunner.query(`DROP TABLE "recurring_expense_items"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expense_items_article"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expense_items_expense"`);
        await queryRunner.query(`DROP TABLE "expense_items"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","subtotal","personal_finance","public","expense_items"]);
        await queryRunner.query(`CREATE INDEX "idx_expenses_article" ON "expenses" ("article_id") `);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_9bc64250e32eb71316dd0cd8197" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}

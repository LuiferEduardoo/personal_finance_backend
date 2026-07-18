import { MigrationInterface, QueryRunner } from "typeorm";

export class FinanceSchema1784405474397 implements MigrationInterface {
    name = 'FinanceSchema1784405474397'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."transaction_kind" AS ENUM('expense', 'income')`);
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "parent_id" uuid, "name" text NOT NULL, "kind" "public"."transaction_kind" NOT NULL, "icon" text, "color" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "categories_name_unique" UNIQUE ("user_id", "parent_id", "name"), CONSTRAINT "categories_no_self_ref" CHECK ("id" <> "parent_id"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_categories_user" ON "categories" ("user_id", "kind") WHERE "is_active"`);
        await queryRunner.query(`CREATE TYPE "public"."payment_method_type" AS ENUM('cash', 'debit', 'credit', 'bank_transfer', 'digital_wallet', 'other')`);
        await queryRunner.query(`CREATE TABLE "payment_methods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" text NOT NULL, "type" "public"."payment_method_type" NOT NULL, "issuer" text, "last_four" character(4), "currency" character(3) NOT NULL DEFAULT 'COP', "credit_limit" numeric(14,2), "statement_day" smallint, "due_day" smallint, "monthly_rate" numeric(6,4), "opening_balance" numeric(14,2) NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "payment_methods_name_unique" UNIQUE ("user_id", "name"), CONSTRAINT "payment_methods_due_day_check" CHECK ("due_day" IS NULL OR "due_day" BETWEEN 1 AND 31), CONSTRAINT "payment_methods_statement_day_check" CHECK ("statement_day" IS NULL OR "statement_day" BETWEEN 1 AND 31), CONSTRAINT "payment_methods_credit_limit_check" CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0), CONSTRAINT "payment_methods_credit_only" CHECK ("type" = 'credit' OR ("credit_limit" IS NULL AND "statement_day" IS NULL AND "due_day" IS NULL)), CONSTRAINT "PK_34f9b8c6dfb4ac3559f7e2820d1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_payment_methods_user" ON "payment_methods" ("user_id") WHERE "is_active"`);
        await queryRunner.query(`CREATE TYPE "public"."installment_status" AS ENUM('pending', 'paid', 'overdue', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "installments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_id" uuid NOT NULL, "sequence_number" smallint NOT NULL, "amount" numeric(14,2) NOT NULL, "principal_amount" numeric(14,2) NOT NULL DEFAULT '0', "interest_amount" numeric(14,2) NOT NULL DEFAULT '0', "due_date" date NOT NULL, "paid_at" date, "status" "public"."installment_status" NOT NULL DEFAULT 'pending', CONSTRAINT "installments_sequence_unique" UNIQUE ("plan_id", "sequence_number"), CONSTRAINT "installments_paid_check" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL)), CONSTRAINT "installments_amount_check" CHECK ("amount" >= 0), CONSTRAINT "installments_sequence_number_check" CHECK ("sequence_number" > 0), CONSTRAINT "PK_c74e44aa06bdebef2af0a93da1b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_installments_pending" ON "installments" ("due_date") WHERE "status" = 'pending'`);
        await queryRunner.query(`CREATE TABLE "installment_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "payment_method_id" uuid NOT NULL, "description" text NOT NULL, "total_amount" numeric(14,2) NOT NULL, "installment_count" smallint NOT NULL, "monthly_rate" numeric(6,4) NOT NULL DEFAULT '0', "purchase_date" date NOT NULL, "first_due_date" date NOT NULL, "is_closed" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "installment_plans_installment_count_check" CHECK ("installment_count" BETWEEN 1 AND 120), CONSTRAINT "installment_plans_total_amount_check" CHECK ("total_amount" > 0), CONSTRAINT "PK_2bcdae2e05a4584743ee0d991db" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_installment_plans_user" ON "installment_plans" ("user_id") WHERE NOT "is_closed"`);
        await queryRunner.query(`CREATE TYPE "public"."recurrence" AS ENUM('once', 'daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual')`);
        await queryRunner.query(`CREATE TABLE "expenses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "category_id" uuid, "payment_method_id" uuid, "plan_id" uuid, "installment_id" uuid, "description" text NOT NULL, "amount" numeric(14,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "exchange_rate" numeric(14,6) NOT NULL DEFAULT '1', "occurred_on" date NOT NULL, "merchant" text, "notes" text, "receipt_url" text, "recurrence" "public"."recurrence" NOT NULL DEFAULT 'once', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0), CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_expenses_category" ON "expenses" ("category_id") `);
        await queryRunner.query(`CREATE INDEX "idx_expenses_payment_method" ON "expenses" ("payment_method_id") `);
        await queryRunner.query(`CREATE INDEX "idx_expenses_user_date" ON "expenses" ("user_id", "occurred_on") `);
        await queryRunner.query(`CREATE TABLE "incomes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "category_id" uuid, "payment_method_id" uuid, "description" text NOT NULL, "source" text, "amount" numeric(14,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "exchange_rate" numeric(14,6) NOT NULL DEFAULT '1', "occurred_on" date NOT NULL, "notes" text, "recurrence" "public"."recurrence" NOT NULL DEFAULT 'once', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "incomes_amount_check" CHECK ("amount" > 0), CONSTRAINT "PK_d737b3d0314c1f0da5461a55e5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_incomes_user_date" ON "incomes" ("user_id", "occurred_on") `);
        await queryRunner.query(`CREATE TABLE "tags" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" text NOT NULL, CONSTRAINT "tags_name_unique" UNIQUE ("user_id", "name"), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "expense_tags" ("expense_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "PK_d2006dcc715802ea59a4fd04435" PRIMARY KEY ("expense_id", "tag_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0a092156be61729db60d4da299" ON "expense_tags" ("expense_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_dca8d34cffafad2bfa95c514aa" ON "expense_tags" ("tag_id") `);
        await queryRunner.query(`CREATE TABLE "income_tags" ("income_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "PK_5c4334098e1081773d314439291" PRIMARY KEY ("income_id", "tag_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_17f02a8635b304a80983ac91cb" ON "income_tags" ("income_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d6bc0456b7bd555a50cf09faa6" ON "income_tags" ("tag_id") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "base_currency" character(3) NOT NULL DEFAULT 'COP'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "timezone" text NOT NULL DEFAULT 'America/Bogota'`);
        await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_2296b7fe012d95646fa41921c8b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_88cea2dc9c31951d06437879b40" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_methods" ADD CONSTRAINT "FK_d7d7fb15569674aaadcfbc0428c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "installments" ADD CONSTRAINT "FK_18da3001e9af675fe4299d7b78f" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "installment_plans" ADD CONSTRAINT "FK_c2a93f749415cbe45048698e0f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "installment_plans" ADD CONSTRAINT "FK_6b0346a18b23cbe24fb4703c026" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_49a0ca239d34e74fdc4e0625a78" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_5d1f4be708e0dfe2afa1a3c376c" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_8a16b10452bdd176884248ce50f" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_e667097d988e90b98e2bff0f07a" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_106a3bafbfafc79c06460e46e51" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incomes" ADD CONSTRAINT "FK_400664fad260d8fa50ecb78ffe6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incomes" ADD CONSTRAINT "FK_aa542e88dd5eaece8243e470962" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incomes" ADD CONSTRAINT "FK_24a1bf2eb3863f1335c956591ab" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tags" ADD CONSTRAINT "FK_74603743868d1e4f4fc2c0225b6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_tags" ADD CONSTRAINT "FK_0a092156be61729db60d4da299b" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "expense_tags" ADD CONSTRAINT "FK_dca8d34cffafad2bfa95c514aa8" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "income_tags" ADD CONSTRAINT "FK_17f02a8635b304a80983ac91cb4" FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "income_tags" ADD CONSTRAINT "FK_d6bc0456b7bd555a50cf09faa68" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE VIEW "transactions" AS 
    SELECT "id", "user_id", "category_id", "payment_method_id", "occurred_on",
           'expense'::"transaction_kind" AS "kind",
           -"amount" AS "signed_amount", "amount", "currency", "description", "notes"
    FROM "expenses"
    UNION ALL
    SELECT "id", "user_id", "category_id", "payment_method_id", "occurred_on",
           'income'::"transaction_kind" AS "kind",
           "amount" AS "signed_amount", "amount", "currency", "description", "notes"
    FROM "incomes"
  `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`, ["public","VIEW","transactions","SELECT \"id\", \"user_id\", \"category_id\", \"payment_method_id\", \"occurred_on\",\n           'expense'::\"transaction_kind\" AS \"kind\",\n           -\"amount\" AS \"signed_amount\", \"amount\", \"currency\", \"description\", \"notes\"\n    FROM \"expenses\"\n    UNION ALL\n    SELECT \"id\", \"user_id\", \"category_id\", \"payment_method_id\", \"occurred_on\",\n           'income'::\"transaction_kind\" AS \"kind\",\n           \"amount\" AS \"signed_amount\", \"amount\", \"currency\", \"description\", \"notes\"\n    FROM \"incomes\""]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`, ["VIEW","transactions","public"]);
        await queryRunner.query(`DROP VIEW "transactions"`);
        await queryRunner.query(`ALTER TABLE "income_tags" DROP CONSTRAINT "FK_d6bc0456b7bd555a50cf09faa68"`);
        await queryRunner.query(`ALTER TABLE "income_tags" DROP CONSTRAINT "FK_17f02a8635b304a80983ac91cb4"`);
        await queryRunner.query(`ALTER TABLE "expense_tags" DROP CONSTRAINT "FK_dca8d34cffafad2bfa95c514aa8"`);
        await queryRunner.query(`ALTER TABLE "expense_tags" DROP CONSTRAINT "FK_0a092156be61729db60d4da299b"`);
        await queryRunner.query(`ALTER TABLE "tags" DROP CONSTRAINT "FK_74603743868d1e4f4fc2c0225b6"`);
        await queryRunner.query(`ALTER TABLE "incomes" DROP CONSTRAINT "FK_24a1bf2eb3863f1335c956591ab"`);
        await queryRunner.query(`ALTER TABLE "incomes" DROP CONSTRAINT "FK_aa542e88dd5eaece8243e470962"`);
        await queryRunner.query(`ALTER TABLE "incomes" DROP CONSTRAINT "FK_400664fad260d8fa50ecb78ffe6"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_106a3bafbfafc79c06460e46e51"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_e667097d988e90b98e2bff0f07a"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_8a16b10452bdd176884248ce50f"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_5d1f4be708e0dfe2afa1a3c376c"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_49a0ca239d34e74fdc4e0625a78"`);
        await queryRunner.query(`ALTER TABLE "installment_plans" DROP CONSTRAINT "FK_6b0346a18b23cbe24fb4703c026"`);
        await queryRunner.query(`ALTER TABLE "installment_plans" DROP CONSTRAINT "FK_c2a93f749415cbe45048698e0f4"`);
        await queryRunner.query(`ALTER TABLE "installments" DROP CONSTRAINT "FK_18da3001e9af675fe4299d7b78f"`);
        await queryRunner.query(`ALTER TABLE "payment_methods" DROP CONSTRAINT "FK_d7d7fb15569674aaadcfbc0428c"`);
        await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_88cea2dc9c31951d06437879b40"`);
        await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_2296b7fe012d95646fa41921c8b"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "timezone"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "base_currency"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6bc0456b7bd555a50cf09faa6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_17f02a8635b304a80983ac91cb"`);
        await queryRunner.query(`DROP TABLE "income_tags"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dca8d34cffafad2bfa95c514aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a092156be61729db60d4da299"`);
        await queryRunner.query(`DROP TABLE "expense_tags"`);
        await queryRunner.query(`DROP TABLE "tags"`);
        await queryRunner.query(`DROP INDEX "public"."idx_incomes_user_date"`);
        await queryRunner.query(`DROP TABLE "incomes"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expenses_user_date"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expenses_payment_method"`);
        await queryRunner.query(`DROP INDEX "public"."idx_expenses_category"`);
        await queryRunner.query(`DROP TABLE "expenses"`);
        await queryRunner.query(`DROP TYPE "public"."recurrence"`);
        await queryRunner.query(`DROP INDEX "public"."idx_installment_plans_user"`);
        await queryRunner.query(`DROP TABLE "installment_plans"`);
        await queryRunner.query(`DROP INDEX "public"."idx_installments_pending"`);
        await queryRunner.query(`DROP TABLE "installments"`);
        await queryRunner.query(`DROP TYPE "public"."installment_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payment_methods_user"`);
        await queryRunner.query(`DROP TABLE "payment_methods"`);
        await queryRunner.query(`DROP TYPE "public"."payment_method_type"`);
        await queryRunner.query(`DROP INDEX "public"."idx_categories_user"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_kind"`);
    }

}

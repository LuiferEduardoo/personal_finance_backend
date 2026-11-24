import { MigrationInterface, QueryRunner } from 'typeorm';

// Créditos personales: el crédito, sus seguros/comisiones, la tabla de
// cuotas (cada cuota pagada apunta a su gasto) y los abonos a capital.
export class Loans1792465000000 implements MigrationInterface {
  name = 'Loans1792465000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loan_rate_type" AS ENUM('monthly', 'effective_annual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loan_status" AS ENUM('active', 'paid_off')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loan_charge_kind" AS ENUM('insurance', 'fee')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loan_charge_mode" AS ENUM('fixed', 'percent_of_balance')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loan_installment_status" AS ENUM('pending', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loan_prepayment_mode" AS ENUM('reduce_term', 'reduce_payment')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" text NOT NULL, "lender" text, "principal_amount" numeric(14,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "rate_type" "loan_rate_type" NOT NULL, "rate" numeric(12,10) NOT NULL, "monthly_rate" numeric(12,10) NOT NULL, "installment_count" smallint NOT NULL, "disbursed_on" date NOT NULL, "first_due_date" date NOT NULL, "disbursement_account_id" uuid, "payment_account_id" uuid, "category_id" uuid, "status" "loan_status" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "loans_installment_count_check" CHECK ("installment_count" BETWEEN 1 AND 600), CONSTRAINT "loans_principal_amount_check" CHECK ("principal_amount" > 0), CONSTRAINT "PK_loans" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_loans_user" ON "loans" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "loan_charges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_id" uuid NOT NULL, "name" text NOT NULL, "kind" "loan_charge_kind" NOT NULL, "mode" "loan_charge_mode" NOT NULL, "value" numeric(20,10) NOT NULL, CONSTRAINT "loan_charges_value_check" CHECK ("value" >= 0), CONSTRAINT "PK_loan_charges" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_loan_charges_loan" ON "loan_charges" ("loan_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "loan_installments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_id" uuid NOT NULL, "sequence_number" smallint NOT NULL, "due_date" date NOT NULL, "opening_balance" numeric(14,2) NOT NULL, "principal_amount" numeric(14,2) NOT NULL, "interest_amount" numeric(14,2) NOT NULL, "charges_amount" numeric(14,2) NOT NULL, "amount" numeric(14,2) NOT NULL, "status" "loan_installment_status" NOT NULL DEFAULT 'pending', "paid_on" date, "expense_id" uuid, CONSTRAINT "loan_installments_sequence_unique" UNIQUE ("loan_id", "sequence_number"), CONSTRAINT "loan_installments_paid_check" CHECK (("status" = 'paid') = ("paid_on" IS NOT NULL)), CONSTRAINT "loan_installments_amount_check" CHECK ("amount" >= 0), CONSTRAINT "loan_installments_sequence_number_check" CHECK ("sequence_number" > 0), CONSTRAINT "PK_loan_installments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "loan_prepayments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "loan_id" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "paid_on" date NOT NULL, "mode" "loan_prepayment_mode" NOT NULL, "expense_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "loan_prepayments_amount_check" CHECK ("amount" > 0), CONSTRAINT "PK_loan_prepayments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_loan_prepayments_loan" ON "loan_prepayments" ("loan_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD CONSTRAINT "FK_loans_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD CONSTRAINT "FK_loans_disbursement_account" FOREIGN KEY ("disbursement_account_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD CONSTRAINT "FK_loans_payment_account" FOREIGN KEY ("payment_account_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD CONSTRAINT "FK_loans_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_charges" ADD CONSTRAINT "FK_loan_charges_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_installments" ADD CONSTRAINT "FK_loan_installments_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_installments" ADD CONSTRAINT "FK_loan_installments_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_prepayments" ADD CONSTRAINT "FK_loan_prepayments_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_prepayments" ADD CONSTRAINT "FK_loan_prepayments_expense" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loan_prepayments" DROP CONSTRAINT "FK_loan_prepayments_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_prepayments" DROP CONSTRAINT "FK_loan_prepayments_loan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_installments" DROP CONSTRAINT "FK_loan_installments_expense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_installments" DROP CONSTRAINT "FK_loan_installments_loan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_charges" DROP CONSTRAINT "FK_loan_charges_loan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP CONSTRAINT "FK_loans_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP CONSTRAINT "FK_loans_payment_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP CONSTRAINT "FK_loans_disbursement_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP CONSTRAINT "FK_loans_user"`,
    );
    await queryRunner.query(`DROP INDEX "idx_loan_prepayments_loan"`);
    await queryRunner.query(`DROP TABLE "loan_prepayments"`);
    await queryRunner.query(`DROP TABLE "loan_installments"`);
    await queryRunner.query(`DROP INDEX "idx_loan_charges_loan"`);
    await queryRunner.query(`DROP TABLE "loan_charges"`);
    await queryRunner.query(`DROP INDEX "idx_loans_user"`);
    await queryRunner.query(`DROP TABLE "loans"`);
    await queryRunner.query(`DROP TYPE "loan_prepayment_mode"`);
    await queryRunner.query(`DROP TYPE "loan_installment_status"`);
    await queryRunner.query(`DROP TYPE "loan_charge_mode"`);
    await queryRunner.query(`DROP TYPE "loan_charge_kind"`);
    await queryRunner.query(`DROP TYPE "loan_status"`);
    await queryRunner.query(`DROP TYPE "loan_rate_type"`);
  }
}

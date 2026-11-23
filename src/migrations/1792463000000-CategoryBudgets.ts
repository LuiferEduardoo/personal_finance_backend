import { MigrationInterface, QueryRunner } from 'typeorm';

// Presupuestos mensuales por categoría (por usuario, también sobre las
// categorías globales) y el registro de avisos enviados, único por
// presupuesto y mes para no repetir el correo.
export class CategoryBudgets1792463000000 implements MigrationInterface {
  name = 'CategoryBudgets1792463000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "category_budgets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "category_id" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'COP', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "category_budgets_category_unique" UNIQUE ("user_id", "category_id"), CONSTRAINT "category_budgets_amount_check" CHECK ("amount" > 0), CONSTRAINT "PK_category_budgets" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "category_budget_alerts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "budget_id" uuid NOT NULL, "period" character(7) NOT NULL, "spent" numeric(14,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "category_budget_alerts_period_unique" UNIQUE ("budget_id", "period"), CONSTRAINT "PK_category_budget_alerts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_budgets" ADD CONSTRAINT "FK_category_budgets_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_budgets" ADD CONSTRAINT "FK_category_budgets_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_budget_alerts" ADD CONSTRAINT "FK_category_budget_alerts_budget" FOREIGN KEY ("budget_id") REFERENCES "category_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "category_budget_alerts" DROP CONSTRAINT "FK_category_budget_alerts_budget"`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_budgets" DROP CONSTRAINT "FK_category_budgets_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_budgets" DROP CONSTRAINT "FK_category_budgets_user"`,
    );
    await queryRunner.query(`DROP TABLE "category_budget_alerts"`);
    await queryRunner.query(`DROP TABLE "category_budgets"`);
  }
}

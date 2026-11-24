import { MigrationInterface, QueryRunner } from 'typeorm';

// Marca los gastos que son pagos de cuota o abonos de un crédito, para que
// no se editen ni borren desde Movimientos. Se rellena desde las cuotas y
// abonos ya registrados.
export class ExpenseLoan1792466000000 implements MigrationInterface {
  name = 'ExpenseLoan1792466000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expenses" ADD "loan_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "idx_expenses_loan" ON "expenses" ("loan_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_expenses_loan" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `UPDATE "expenses" e SET "loan_id" = i."loan_id" FROM "loan_installments" i WHERE i."expense_id" = e."id"`,
    );
    await queryRunner.query(
      `UPDATE "expenses" e SET "loan_id" = p."loan_id" FROM "loan_prepayments" p WHERE p."expense_id" = e."id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "expenses" DROP CONSTRAINT "FK_expenses_loan"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_expenses_loan"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "loan_id"`);
  }
}

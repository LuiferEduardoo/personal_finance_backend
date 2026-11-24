import { MigrationInterface, QueryRunner } from 'typeorm';

// Capital (sin intereses) de cada compra a cuotas, para poder editarla y
// recalcular la tabla. Los planes existentes lo toman de la suma del capital
// de sus cuotas (o del total si no tuvieran cuotas).
export class InstallmentPlanPrincipal1792464000000 implements MigrationInterface {
  name = 'InstallmentPlanPrincipal1792464000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "installment_plans" ADD "principal_amount" numeric(14,2)`,
    );
    await queryRunner.query(
      `UPDATE "installment_plans" p SET "principal_amount" = COALESCE((SELECT SUM(i."principal_amount") FROM "installments" i WHERE i."plan_id" = p."id"), p."total_amount")`,
    );
    await queryRunner.query(
      `ALTER TABLE "installment_plans" ALTER COLUMN "principal_amount" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "installment_plans" DROP COLUMN "principal_amount"`,
    );
  }
}

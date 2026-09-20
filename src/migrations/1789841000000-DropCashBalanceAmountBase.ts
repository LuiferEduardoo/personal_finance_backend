import { MigrationInterface, QueryRunner } from 'typeorm';

// Deshace 1789840000000. Acumular el efectivo a las tasas congeladas de cada
// movimiento es contabilidad correcta, pero no describe un saldo: en una cuenta
// de una sola moneda el resultado se aleja del saldo real tanto como la divisa
// se haya movido entre el ingreso y el gasto. Con datos reales, 2,52 USD de
// efectivo en XTB salían como 11,86. El efectivo vuelve a valorarse a tasa de
// cierre; la diferencia de cambio no pertenece a esta línea.
export class DropCashBalanceAmountBase1789841000000 implements MigrationInterface {
  name = 'DropCashBalanceAmountBase1789841000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investment_cash_balances" DROP COLUMN "amount_base"`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investment_cash_balances" ADD "amount_base" numeric(20,6) NOT NULL DEFAULT 0`,
    );
  }
}

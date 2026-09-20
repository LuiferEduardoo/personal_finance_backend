import { MigrationInterface, QueryRunner } from 'typeorm';

export class CashBalanceAmountBase1789840000000 implements MigrationInterface {
  name = 'CashBalanceAmountBase1789840000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investment_cash_balances" ADD "amount_base" numeric(20,6) NOT NULL DEFAULT 0`,
    );
    // Los saldos existentes se quedan en 0 a propósito: el valor correcto solo
    // sale de reproducir el libro con la tasa congelada de cada movimiento, no
    // de multiplicar el neto por una tasa. `rebuildInvestmentPositions` los
    // regenera; hasta entonces el resumen los cuenta como 0, que es visible,
    // en vez de arrastrar la cifra inflada, que no lo era.
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "investment_cash_balances" DROP COLUMN "amount_base"`,
    );
  }
}

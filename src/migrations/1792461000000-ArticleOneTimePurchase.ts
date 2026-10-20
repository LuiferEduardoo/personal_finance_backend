import { MigrationInterface, QueryRunner } from 'typeorm';

export class ArticleOneTimePurchase1792461000000 implements MigrationInterface {
  name = 'ArticleOneTimePurchase1792461000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "is_one_time" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "is_one_time"`);
  }
}

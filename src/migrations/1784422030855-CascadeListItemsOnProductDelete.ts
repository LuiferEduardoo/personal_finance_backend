import { MigrationInterface, QueryRunner } from "typeorm";

export class CascadeListItemsOnProductDelete1784422030855 implements MigrationInterface {
    name = 'CascadeListItemsOnProductDelete1784422030855'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shopping_list_items" DROP CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769"`);
        await queryRunner.query(`ALTER TABLE "shopping_list_items" ADD CONSTRAINT "FK_2b7cdc20ef2ccc347037432d769" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}

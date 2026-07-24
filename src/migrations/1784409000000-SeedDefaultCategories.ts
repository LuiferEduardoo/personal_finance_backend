import { MigrationInterface, QueryRunner } from 'typeorm';

// Categorías del sistema (user_id NULL): visibles para todos los usuarios.
// UUIDs fijos para poder referenciar padres e identificar el seed.
export class SeedDefaultCategories1784409000000 implements MigrationInterface {
  name = 'SeedDefaultCategories1784409000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- Gastos ----
    const expenseParents: [string, string, string][] = [
      ['10000000-0000-4000-8000-000000000001', 'Alimentación', '🍽️'],
      ['10000000-0000-4000-8000-000000000002', 'Transporte', '🚗'],
      ['10000000-0000-4000-8000-000000000003', 'Vivienda', '🏠'],
      ['10000000-0000-4000-8000-000000000004', 'Salud', '🩺'],
      ['10000000-0000-4000-8000-000000000005', 'Entretenimiento', '🎬'],
      ['10000000-0000-4000-8000-000000000006', 'Educación', '📚'],
      ['10000000-0000-4000-8000-000000000007', 'Ropa y cuidado personal', '👕'],
      ['10000000-0000-4000-8000-000000000008', 'Tecnología', '💻'],
      ['10000000-0000-4000-8000-000000000009', 'Mascotas', '🐾'],
      ['10000000-0000-4000-8000-000000000010', 'Deudas y cuotas', '💳'],
      ['10000000-0000-4000-8000-000000000011', 'Otros gastos', '📦'],
    ];

    const expenseChildren: [string, string][] = [
      ['10000000-0000-4000-8000-000000000001', 'Mercado'],
      ['10000000-0000-4000-8000-000000000001', 'Restaurantes'],
      ['10000000-0000-4000-8000-000000000001', 'Domicilios'],
      ['10000000-0000-4000-8000-000000000002', 'Combustible'],
      ['10000000-0000-4000-8000-000000000002', 'Transporte público'],
      ['10000000-0000-4000-8000-000000000002', 'Taxi / Apps'],
      ['10000000-0000-4000-8000-000000000002', 'Mantenimiento vehículo'],
      ['10000000-0000-4000-8000-000000000003', 'Arriendo'],
      ['10000000-0000-4000-8000-000000000003', 'Servicios públicos'],
      ['10000000-0000-4000-8000-000000000003', 'Internet y telefonía'],
      ['10000000-0000-4000-8000-000000000003', 'Mantenimiento hogar'],
      ['10000000-0000-4000-8000-000000000004', 'Medicamentos'],
      ['10000000-0000-4000-8000-000000000004', 'Consultas'],
      ['10000000-0000-4000-8000-000000000004', 'Seguros'],
      ['10000000-0000-4000-8000-000000000005', 'Streaming'],
      ['10000000-0000-4000-8000-000000000005', 'Salidas'],
    ];

    // ---- Ingresos ----
    const incomeParents: [string, string, string][] = [
      ['20000000-0000-4000-8000-000000000001', 'Salario', '💼'],
      ['20000000-0000-4000-8000-000000000002', 'Freelance', '🧑‍💻'],
      ['20000000-0000-4000-8000-000000000003', 'Inversiones', '📈'],
      ['20000000-0000-4000-8000-000000000004', 'Regalos', '🎁'],
      ['20000000-0000-4000-8000-000000000005', 'Reembolsos', '↩️'],
      ['20000000-0000-4000-8000-000000000006', 'Otros ingresos', '📦'],
    ];

    for (const [id, name, icon] of expenseParents) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "user_id", "parent_id", "name", "kind", "icon") VALUES ($1, NULL, NULL, $2, 'expense', $3)`,
        [id, name, icon],
      );
    }
    for (const [parentId, name] of expenseChildren) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "user_id", "parent_id", "name", "kind") VALUES (gen_random_uuid(), NULL, $1, $2, 'expense')`,
        [parentId, name],
      );
    }
    for (const [id, name, icon] of incomeParents) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "user_id", "parent_id", "name", "kind", "icon") VALUES ($1, NULL, NULL, $2, 'income', $3)`,
        [id, name, icon],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // borra hijos por cascade al borrar los padres del seed
    await queryRunner.query(
      `DELETE FROM "categories" WHERE "user_id" IS NULL AND ("id"::text LIKE '10000000-%' OR "id"::text LIKE '20000000-%')`,
    );
  }
}

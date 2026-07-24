import 'dotenv/config';
import { DataSource } from 'typeorm';

// DataSource para el CLI de TypeORM (migraciones)
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'personal_finance',
  // esquema explícito: algunas BD gestionadas dejan el search_path vacío
  // y sin esto falla con "no schema has been selected to create in"
  schema: process.env.DB_SCHEMA ?? 'public',
  entities: ['src/**/*.entity.ts', 'src/**/*.view.ts'],
  migrations: ['src/migrations/*.ts'],
});

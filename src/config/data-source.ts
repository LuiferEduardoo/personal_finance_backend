import 'dotenv/config';
import { DataSource } from 'typeorm';

// esquema donde viven las tablas. Algunas BD gestionadas (p. ej. Filess.io)
// no dan acceso a "public": cada base tiene su propio esquema con el nombre
// de la base y el search_path llega vacío, lo que rompe con
// "no schema has been selected to create in". Se fija el esquema y, además,
// el search_path a nivel de conexión para que resuelvan tablas y funciones
// (uuid_generate_v4, etc.).
const schema = process.env.DB_SCHEMA ?? 'public';

// DataSource para el CLI de TypeORM (migraciones)
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'personal_finance',
  schema,
  extra: { options: `-c search_path=${schema},public` },
  entities: ['src/**/*.entity.ts', 'src/**/*.view.ts'],
  migrations: ['src/migrations/*.ts'],
});

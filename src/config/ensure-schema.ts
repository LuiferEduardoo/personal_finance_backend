import 'dotenv/config';
import AppDataSource from './data-source';

// Crea el esquema (DB_SCHEMA) si no existe, antes de correr las migraciones.
// Útil en BD gestionadas donde el esquema es el nombre de la base (Filess.io).
// "public" siempre existe, así que se omite.
async function main(): Promise<void> {
  const schema = process.env.DB_SCHEMA ?? 'public';
  if (schema === 'public') {
    console.log('Esquema "public": no requiere creación.');
    return;
  }
  await AppDataSource.initialize();
  await AppDataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await AppDataSource.destroy();
  console.log(`Esquema "${schema}" verificado/creado.`);
}

main().catch((error) => {
  console.error('Error verificando el esquema:', error);
  process.exit(1);
});

import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  // ver nota en data-source.ts: algunas BD gestionadas (Filess.io) no usan
  // "public"; se fija el esquema y el search_path de la conexión.
  const schema = configService.get<string>('DB_SCHEMA', 'public');
  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST', 'localhost'),
    port: configService.get<number>('DB_PORT', 5432),
    username: configService.get<string>('DB_USERNAME', 'postgres'),
    password: configService.get<string>('DB_PASSWORD', ''),
    database: configService.get<string>('DB_NAME', 'personal_finance'),
    schema,
    extra: { options: `-c search_path=${schema},public` },
    autoLoadEntities: true,
    // el esquema se maneja con migraciones (npm run migration:run)
    synchronize: false,
  };
};

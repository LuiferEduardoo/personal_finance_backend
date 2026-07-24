import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USERNAME', 'postgres'),
  password: configService.get<string>('DB_PASSWORD', ''),
  database: configService.get<string>('DB_NAME', 'personal_finance'),
  // esquema explícito (algunas BD gestionadas dejan el search_path vacío)
  schema: configService.get<string>('DB_SCHEMA', 'public'),
  autoLoadEntities: true,
  // el esquema se maneja con migraciones (npm run migration:run)
  synchronize: false,
});

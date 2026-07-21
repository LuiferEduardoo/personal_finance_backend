import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// orígenes del frontend permitidos; se pueden sobrescribir con CORS_ORIGINS
// (lista separada por comas) o abrir del todo con CORS_ORIGINS=*
const DEFAULT_ORIGINS = ['http://localhost:5174', 'http://localhost:5173'];

function corsOrigin(): string[] | boolean {
  const configured = process.env.CORS_ORIGINS?.trim();
  if (!configured) {
    return DEFAULT_ORIGINS;
  }
  if (configured === '*') {
    return true;
  }
  return configured.split(',').map((origin) => origin.trim());
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: corsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Apollo-Require-Preflight'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

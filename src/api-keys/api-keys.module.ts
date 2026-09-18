import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysResolver } from './api-keys.resolver';
import { ApiKeysService } from './api-keys.service';
import { ApiKey } from './entities/api-key.entity';

// Global porque los guards de auth se instancian en el contexto de cada
// módulo que los usa y todos necesitan resolver ApiKeysService.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  providers: [ApiKeysService, ApiKeysResolver],
  exports: [TypeOrmModule, ApiKeysService],
})
export class ApiKeysModule {}

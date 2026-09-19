import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiScope } from '../common/enums/api-scope.enum';
import { Principal, PrincipalKind } from '../auth/principal';
import { ApiKeyCreated } from './dto/api-key-created.type';
import { CreateApiKeyInput } from './dto/create-api-key.input';
import { UpdateApiKeyInput } from './dto/update-api-key.input';
import { ApiKey } from './entities/api-key.entity';

// formato del token: pfk_<id público>_<secreto>
const TOKEN_PREFIX = 'pfk';
const PUBLIC_ID_BYTES = 6;
const SECRET_BYTES = 32;

// evita un UPDATE por petición: solo refresca last_used_at cada minuto
const LAST_USED_REFRESH_MS = 60_000;
const ALLOWED_API_SCOPES = new Set<ApiScope>([
  // Se conserva para que las claves históricas de acceso completo sigan
  // funcionando. Los guards UserOnly continúan bloqueando credenciales.
  ApiScope.ALL,
  ApiScope.EXPENSES_READ,
  ApiScope.EXPENSES_WRITE,
  ApiScope.INCOMES_READ,
  ApiScope.INCOMES_WRITE,
  ApiScope.CATEGORIES_READ,
  ApiScope.CATEGORIES_WRITE,
  ApiScope.ACCOUNTS_READ,
  ApiScope.ACCOUNTS_WRITE,
  ApiScope.ARTICLES_READ,
  ApiScope.ARTICLES_WRITE,
  ApiScope.PRODUCTS_READ,
  ApiScope.PRODUCTS_WRITE,
  ApiScope.INVENTORY_READ,
  ApiScope.INVENTORY_WRITE,
  ApiScope.RECURRING_READ,
  ApiScope.RECURRING_WRITE,
  ApiScope.INFLATION_READ,
  ApiScope.INVOICES_WRITE,
  ApiScope.INVESTMENTS_READ,
  ApiScope.INVESTMENTS_WRITE,
  ApiScope.MARKET_DATA_READ,
]);

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeysRepository: Repository<ApiKey>,
  ) {}

  findAll(userId: string): Promise<ApiKey[]> {
    return this.apiKeysRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Crea la key y devuelve el token completo. Es la única vez que el token
   * existe fuera del cliente: en la base solo queda su hash.
   */
  async create(
    userId: string,
    input: CreateApiKeyInput,
  ): Promise<ApiKeyCreated> {
    this.validateName(input.name);
    this.validateExpiration(input.expiresAt);
    const prefix = `${TOKEN_PREFIX}_${randomBytes(PUBLIC_ID_BYTES).toString('hex')}`;
    const token = `${prefix}_${randomBytes(SECRET_BYTES).toString('base64url')}`;

    const apiKey = await this.apiKeysRepository.save(
      this.apiKeysRepository.create({
        userId,
        name: input.name.trim(),
        prefix,
        keyHash: this.hash(token),
        scopes: this.normalizeScopes(input.scopes),
        expiresAt: input.expiresAt ?? null,
      }),
    );

    return { apiKey, token };
  }

  async update(userId: string, input: UpdateApiKeyInput): Promise<ApiKey> {
    const apiKey = await this.findOne(userId, input.id);
    if (input.name !== undefined) {
      this.validateName(input.name);
      apiKey.name = input.name.trim();
    }
    if (input.scopes !== undefined) {
      apiKey.scopes = this.normalizeScopes(input.scopes);
    }
    if (input.expiresAt !== undefined) {
      this.validateExpiration(input.expiresAt);
      apiKey.expiresAt = input.expiresAt;
    }
    return this.apiKeysRepository.save(apiKey);
  }

  // revocar es irreversible: la key deja de autenticar de inmediato
  async revoke(userId: string, id: string): Promise<ApiKey> {
    const apiKey = await this.findOne(userId, id);
    if (!apiKey.revokedAt) {
      apiKey.revokedAt = new Date();
      await this.apiKeysRepository.save(apiKey);
    }
    return apiKey;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const apiKey = await this.findOne(userId, id);
    await this.apiKeysRepository.remove(apiKey);
    return true;
  }

  async findOne(userId: string, id: string): Promise<ApiKey> {
    const apiKey = await this.apiKeysRepository.findOne({
      where: { id, userId },
    });
    if (!apiKey) {
      throw new NotFoundException(`API key ${id} no encontrada`);
    }
    return apiKey;
  }

  /**
   * Valida el token de una petición y devuelve el principal con sus scopes.
   * Rechaza keys revocadas, expiradas o de un usuario inactivo.
   */
  async verify(token: string): Promise<Principal> {
    const prefix = this.extractPrefix(token);
    const apiKey = await this.apiKeysRepository.findOne({
      where: { prefix },
      relations: { user: true },
    });
    if (!apiKey || !this.matches(token, apiKey.keyHash)) {
      throw new UnauthorizedException('API key inválida');
    }
    if (apiKey.revokedAt) {
      throw new UnauthorizedException('API key revocada');
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('API key expirada');
    }
    if (!apiKey.user?.isActive) {
      throw new UnauthorizedException('El usuario de la API key está inactivo');
    }

    await this.touch(apiKey);

    return {
      sub: apiKey.userId,
      email: apiKey.user.email,
      kind: PrincipalKind.API_KEY,
      scopes: apiKey.scopes.filter((scope) => ALLOWED_API_SCOPES.has(scope)),
      apiKeyId: apiKey.id,
    };
  }

  // ALL absorbe al resto: guardar los dos sería redundante y confuso
  private normalizeScopes(scopes: ApiScope[]): ApiScope[] {
    if (!scopes?.length) {
      throw new BadRequestException('La API key necesita al menos un scope');
    }
    const unique = [...new Set(scopes)];
    const invalid = unique.filter((scope) => !ALLOWED_API_SCOPES.has(scope));
    if (invalid.length) {
      throw new BadRequestException(
        `La API key contiene permisos no admitidos: ${invalid.join(', ')}`,
      );
    }
    return unique;
  }

  private validateName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('El nombre de la API key es obligatorio');
    }
    if (trimmed.length > 100) {
      throw new BadRequestException(
        'El nombre de la API key no puede superar 100 caracteres',
      );
    }
  }

  private validateExpiration(expiresAt?: Date | null): void {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La fecha de expiración debe estar en el futuro',
      );
    }
  }

  private extractPrefix(token: string): string {
    const parts = token.split('_');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
      throw new UnauthorizedException('API key inválida');
    }
    return `${parts[0]}_${parts[1]}`;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // comparación en tiempo constante: no filtra el hash por el tiempo de respuesta
  private matches(token: string, keyHash: string): boolean {
    const provided = Buffer.from(this.hash(token), 'hex');
    const stored = Buffer.from(keyHash, 'hex');
    return (
      provided.length === stored.length && timingSafeEqual(provided, stored)
    );
  }

  private async touch(apiKey: ApiKey): Promise<void> {
    const last = apiKey.lastUsedAt?.getTime() ?? 0;
    if (Date.now() - last < LAST_USED_REFRESH_MS) {
      return;
    }
    await this.apiKeysRepository.update(apiKey.id, { lastUsedAt: new Date() });
  }
}

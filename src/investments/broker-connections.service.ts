import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecretBox } from '../common/crypto/secret-box';
import { BrokerKind } from '../common/enums/broker-kind.enum';
import {
  BrokerCredentials,
  needsReauth,
} from './connectors/broker-connector.interface';
import { BrokerConnectorRegistry } from './connectors/connector.registry';
import {
  BrokerConnection,
  BrokerConnectionStatus,
} from './entities/broker-connection.entity';

export interface CreateConnectionInput {
  broker: BrokerKind;
  label: string;
  isDemo?: boolean;
  autoSync?: boolean;
  credentials: Record<string, unknown>;
}

// El bróker NO se puede cambiar en un update: cambiarlo invalidaría las
// credenciales guardadas y el cursor de sincronización.
export interface UpdateConnectionInput {
  id: string;
  label?: string;
  isDemo?: boolean;
  autoSync?: boolean;
  credentials?: Record<string, unknown>;
}

// Gestiona las conexiones y, sobre todo, sus credenciales.
//
// NINGÚN método devuelve credenciales descifradas al exterior: `credentialsOf`
// es el único punto de descifrado y lo consume solo el servicio de
// sincronización, que las pasa directas al conector.
@Injectable()
export class BrokerConnectionsService {
  private readonly logger = new Logger(BrokerConnectionsService.name);

  constructor(
    @InjectRepository(BrokerConnection)
    private readonly connectionsRepository: Repository<BrokerConnection>,
    private readonly secretBox: SecretBox,
    private readonly registry: BrokerConnectorRegistry,
  ) {}

  findAll(userId: string): Promise<BrokerConnection[]> {
    return this.connectionsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<BrokerConnection> {
    const connection = await this.connectionsRepository.findOne({
      where: { id, userId },
    });
    if (!connection) {
      throw new NotFoundException(`Conexión ${id} no encontrada`);
    }
    return connection;
  }

  async create(
    userId: string,
    input: CreateConnectionInput,
  ): Promise<BrokerConnection> {
    if (!this.registry.supports(input.broker)) {
      throw new BadRequestException(
        `El bróker ${input.broker} no admite conexión automática. Importa el statement por archivo.`,
      );
    }
    this.assertCredentials(input.broker, input.credentials);

    // se guarda primero para tener el id: el AAD del cifrado ata el secreto a
    // ESTA fila, así que hace falta el id antes de sellar
    const connection = await this.connectionsRepository.save(
      this.connectionsRepository.create({
        userId,
        broker: input.broker,
        label: input.label,
        isDemo: input.isDemo ?? false,
        autoSync: input.autoSync ?? true,
        status: BrokerConnectionStatus.ACTIVE,
      }),
    );

    return this.storeCredentials(connection, {
      ...input.credentials,
      isDemo: input.isDemo ?? false,
    });
  }

  async update(
    userId: string,
    input: UpdateConnectionInput,
  ): Promise<BrokerConnection> {
    const connection = await this.findOne(input.id, userId);
    if (input.label !== undefined) {
      connection.label = input.label;
    }
    if (input.isDemo !== undefined) {
      connection.isDemo = input.isDemo;
    }
    if (input.autoSync !== undefined) {
      connection.autoSync = input.autoSync;
    }
    await this.connectionsRepository.save(connection);

    if (input.credentials) {
      this.assertCredentials(connection.broker, input.credentials);
      return this.storeCredentials(connection, {
        ...input.credentials,
        isDemo: connection.isDemo,
      });
    }
    return this.findOne(input.id, userId);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const connection = await this.findOne(id, userId);
    await this.connectionsRepository.remove(connection);
    return true;
  }

  async setStatus(
    id: string,
    status: BrokerConnectionStatus,
    error?: string | null,
  ): Promise<void> {
    await this.connectionsRepository.update(
      { id },
      { status, lastError: error ?? null },
    );
  }

  async setCursor(id: string, cursor: Record<string, unknown>): Promise<void> {
    await this.connectionsRepository.update(
      { id },
      { lastSyncCursor: cursor, lastSyncedAt: new Date() },
    );
  }

  // ÚNICO punto de descifrado del sistema. Devuelve un objeto que se redacta
  // solo al serializarse, para que un log accidental no filtre la contraseña.
  credentialsOf(connection: BrokerConnection): BrokerCredentials {
    if (
      !connection.credentialsCiphertext ||
      !connection.credentialsIv ||
      !connection.credentialsTag
    ) {
      throw new BadRequestException(
        'La conexión no tiene credenciales guardadas',
      );
    }
    const values = this.secretBox.openJson<Record<string, unknown>>(
      {
        ciphertext: connection.credentialsCiphertext,
        iv: connection.credentialsIv,
        tag: connection.credentialsTag,
        keyVersion: connection.credentialsKeyVersion,
      },
      connection.id,
    );
    return new BrokerCredentials(values);
  }

  async verify(id: string, userId: string): Promise<BrokerConnection> {
    const connection = await this.findOne(id, userId);
    const connector = this.registry.get(connection.broker);
    try {
      await connector.verifyCredentials(this.credentialsOf(connection));
      await this.setStatus(id, BrokerConnectionStatus.ACTIVE, null);
    } catch (error) {
      const message = (error as Error).message;
      await this.setStatus(
        id,
        needsReauth(message)
          ? BrokerConnectionStatus.NEEDS_REAUTH
          : BrokerConnectionStatus.ERROR,
        message,
      );
      throw error;
    }
    return this.findOne(id, userId);
  }

  // Re-sella las credenciales con la clave actual. Es la rotación: se pone la
  // clave vieja en INVESTMENTS_ENCRYPTION_KEY_PREVIOUS, la nueva en la actual,
  // y esto migra las filas sin cortar el servicio.
  async rotate(userId: string): Promise<number> {
    const connections = await this.findAll(userId);
    let rotated = 0;
    for (const connection of connections) {
      if (!connection.credentialsCiphertext) {
        continue;
      }
      try {
        const values = this.secretBox.openJson<Record<string, unknown>>(
          {
            ciphertext: connection.credentialsCiphertext,
            iv: connection.credentialsIv!,
            tag: connection.credentialsTag!,
            keyVersion: connection.credentialsKeyVersion,
          },
          connection.id,
        );
        await this.storeCredentials(connection, values);
        rotated += 1;
      } catch (error) {
        this.logger.error(
          `No se pudieron rotar las credenciales de ${connection.id}: ${(error as Error).message}`,
        );
      }
    }
    return rotated;
  }

  private async storeCredentials(
    connection: BrokerConnection,
    values: Record<string, unknown>,
  ): Promise<BrokerConnection> {
    const sealed = this.secretBox.sealJson(values, connection.id);
    await this.connectionsRepository.update(
      { id: connection.id },
      {
        credentialsCiphertext: sealed.ciphertext,
        credentialsIv: sealed.iv,
        credentialsTag: sealed.tag,
        credentialsKeyVersion: sealed.keyVersion,
      },
    );
    return this.findOne(connection.id, connection.userId);
  }

  private assertCredentials(
    broker: BrokerKind,
    credentials?: Record<string, unknown>,
  ): void {
    const required = this.registry.requiredCredentials(broker);
    const missing = required.filter(
      (key) => typeof credentials?.[key] !== 'string' || !credentials[key],
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Faltan credenciales para ${broker}: ${missing.join(', ')}`,
      );
    }
    // y además que tengan la FORMA correcta, no solo que estén
    this.registry.validateCredentials(broker, credentials ?? {});
  }
}

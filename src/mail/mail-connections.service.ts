import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { SecretBox } from '../common/crypto/secret-box';
import {
  GmailApi,
  GmailClientService,
  isInvalidGrant,
} from './gmail/gmail-client.service';
import {
  MailConnection,
  MailConnectionStatus,
} from './entities/mail-connection.entity';

export const MAIL_SECRET_BOX = Symbol('MAIL_SECRET_BOX');

const STATE_PURPOSE = 'gmail-oauth';
const STATE_TTL = '10m';

// Gestiona los buzones conectados y su refresh token.
//
// Igual que con los brókers, NINGÚN método devuelve el token descifrado al
// exterior: `gmailFor` lo abre y lo entrega directamente al cliente de Gmail.
@Injectable()
export class MailConnectionsService {
  private readonly logger = new Logger(MailConnectionsService.name);

  constructor(
    @InjectRepository(MailConnection)
    private readonly connectionsRepository: Repository<MailConnection>,
    @Inject(MAIL_SECRET_BOX) private readonly secretBox: SecretBox,
    private readonly gmailClient: GmailClientService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  findAll(userId: string): Promise<MailConnection[]> {
    return this.connectionsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<MailConnection> {
    const connection = await this.connectionsRepository.findOne({
      where: { id, userId },
    });
    if (!connection) {
      throw new NotFoundException(`Conexión de correo ${id} no encontrada`);
    }
    return connection;
  }

  findActive(): Promise<MailConnection[]> {
    return this.connectionsRepository.find({
      where: { status: MailConnectionStatus.ACTIVE },
    });
  }

  // un mismo buzón puede estar conectado por varios usuarios
  findActiveByEmail(emailAddress: string): Promise<MailConnection[]> {
    return this.connectionsRepository.find({
      where: {
        emailAddress: emailAddress.toLowerCase(),
        status: MailConnectionStatus.ACTIVE,
      },
    });
  }

  // suscripciones push que caducan antes de `before` (o que nunca se hicieron)
  findWatchesExpiringBefore(before: Date): Promise<MailConnection[]> {
    return this.connectionsRepository.find({
      where: [
        {
          status: MailConnectionStatus.ACTIVE,
          watchExpiresAt: LessThan(before),
        },
        { status: MailConnectionStatus.ACTIVE, watchExpiresAt: IsNull() },
      ],
    });
  }

  // URL de consentimiento de Google. El `state` es un JWT corto que ata el
  // callback al usuario que inició la conexión.
  authUrl(userId: string): string {
    return this.gmailClient.authUrl(
      this.jwtService.sign(
        { sub: userId, purpose: STATE_PURPOSE },
        { secret: this.stateSecret(), expiresIn: STATE_TTL },
      ),
    );
  }

  // Callback de Google: canjea el código, guarda el buzón y lo suscribe.
  async connect(state: string, code: string): Promise<MailConnection> {
    const userId = this.verifyState(state);
    const { refreshToken, emailAddress } =
      await this.gmailClient.exchangeCode(code);

    // reconectar el mismo buzón reutiliza la fila: conserva remitentes y
    // bitácora, solo cambia el token
    let connection = await this.connectionsRepository.findOne({
      where: { userId, emailAddress },
    });
    connection ??= await this.connectionsRepository.save(
      this.connectionsRepository.create({ userId, emailAddress }),
    );

    // el AAD ata el token a ESTA fila, así que se sella después de tener id
    const sealed = this.secretBox.seal(refreshToken, connection.id);
    await this.connectionsRepository.update(
      { id: connection.id },
      {
        tokenCiphertext: sealed.ciphertext,
        tokenIv: sealed.iv,
        tokenTag: sealed.tag,
        tokenKeyVersion: sealed.keyVersion,
        status: MailConnectionStatus.ACTIVE,
        lastError: null,
      },
    );
    connection = await this.findOne(connection.id, userId);

    // Solo se leen correos NUEVOS desde este punto; los antiguos llegan por
    // la lectura de antiguos de cada remitente.
    const api = this.gmailFor(connection);
    if (!connection.historyId) {
      await this.connectionsRepository.update(
        { id: connection.id },
        { historyId: await this.gmailClient.currentHistoryId(api) },
      );
    }
    await this.renewWatch(connection);
    return this.findOne(connection.id, userId);
  }

  async disconnect(id: string, userId: string): Promise<boolean> {
    const connection = await this.findOne(id, userId);
    const token = this.tokenOf(connection);
    if (token) {
      // lo mejor posible: si Google falla, la fila se borra igual
      try {
        const api = this.gmailClient.forToken(token);
        if (this.gmailClient.pushConfigured) {
          await this.gmailClient.stopWatch(api);
        }
        await this.gmailClient.revoke(token);
      } catch (error) {
        this.logger.warn(
          `No se pudo revocar el acceso de ${connection.id}: ${(error as Error).message}`,
        );
      }
    }
    await this.connectionsRepository.remove(connection);
    return true;
  }

  // Renueva la suscripción push. Sin topic configurado no hace nada: los
  // correos nuevos llegan igual con el job horario.
  async renewWatch(connection: MailConnection): Promise<void> {
    if (!this.gmailClient.pushConfigured) {
      return;
    }
    try {
      const result = await this.gmailClient.watch(this.gmailFor(connection));
      await this.connectionsRepository.update(
        { id: connection.id },
        { watchExpiresAt: result.expiresAt },
      );
    } catch (error) {
      await this.recordFailure(connection, error);
      throw error;
    }
  }

  // ÚNICO punto de descifrado del token.
  gmailFor(connection: MailConnection): GmailApi {
    const token = this.tokenOf(connection);
    if (!token) {
      throw new UnauthorizedException(
        'La conexión de correo no tiene token: vuelve a conectar el buzón',
      );
    }
    return this.gmailClient.forToken(token);
  }

  async markSynced(id: string, historyId: string | null): Promise<void> {
    await this.connectionsRepository.update(
      { id },
      {
        ...(historyId ? { historyId } : {}),
        lastSyncedAt: new Date(),
        lastError: null,
      },
    );
  }

  // invalid_grant = el usuario revocó el acceso: reintentar no sirve
  async recordFailure(
    connection: MailConnection,
    error: unknown,
  ): Promise<void> {
    await this.connectionsRepository.update(
      { id: connection.id },
      {
        status: isInvalidGrant(error)
          ? MailConnectionStatus.NEEDS_REAUTH
          : connection.status,
        lastError: (error as Error).message,
      },
    );
  }

  private tokenOf(connection: MailConnection): string | null {
    if (
      !connection.tokenCiphertext ||
      !connection.tokenIv ||
      !connection.tokenTag
    ) {
      return null;
    }
    return this.secretBox.open(
      {
        ciphertext: connection.tokenCiphertext,
        iv: connection.tokenIv,
        tag: connection.tokenTag,
        keyVersion: connection.tokenKeyVersion,
      },
      connection.id,
    );
  }

  private verifyState(state: string): string {
    try {
      const payload = this.jwtService.verify<{ sub: string; purpose: string }>(
        state,
        { secret: this.stateSecret() },
      );
      if (payload.purpose !== STATE_PURPOSE || !payload.sub) {
        throw new Error('propósito inválido');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException(
        'El enlace de conexión con Gmail es inválido o caducó',
      );
    }
  }

  // Secreto DISTINTO del de los access tokens: el state viaja en la URL, y
  // firmado con JWT_SECRET serviría como access token si se filtrara.
  private stateSecret(): string {
    return `${this.configService.get<string>('JWT_SECRET', '')}:${STATE_PURPOSE}`;
  }
}

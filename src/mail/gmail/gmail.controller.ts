import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MailConnectionsService } from '../mail-connections.service';
import { MailSyncService } from '../mail-sync.service';
import { GmailClientService } from './gmail-client.service';

// cuerpo que Pub/Sub manda a un endpoint push
interface PubSubPush {
  message?: { data?: string; messageId?: string };
  subscription?: string;
}

// lo que Gmail publica en el topic: qué buzón cambió y hasta qué historyId
interface GmailNotification {
  emailAddress?: string;
  historyId?: string | number;
}

// Rutas públicas por necesidad: a ellas llama Google, no el frontend, así que
// no llevan JWT. Cada una se autentica a su manera.
@Controller('mail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(
    private readonly connectionsService: MailConnectionsService,
    private readonly syncService: MailSyncService,
    private readonly gmailClient: GmailClientService,
    private readonly configService: ConfigService,
  ) {}

  // Notificación push de Gmail vía Pub/Sub. La autentica el token OIDC que
  // firma Google para nuestra cuenta de servicio.
  //
  // Se responde 204 en cuanto se valida y la sincronización sigue en segundo
  // plano: si Pub/Sub no recibe respuesta a tiempo, reintenta y duplica
  // trabajo. Cualquier 2xx confirma el mensaje.
  @Post('gmail/push')
  @HttpCode(204)
  async gmailPush(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PubSubPush,
  ): Promise<void> {
    const [scheme, token] = (authorization ?? '').split(' ');
    if (
      scheme !== 'Bearer' ||
      !token ||
      !(await this.gmailClient.verifyPushToken(token))
    ) {
      throw new UnauthorizedException('Notificación push no autenticada');
    }

    const notification = decodeNotification(body);
    if (!notification?.emailAddress) {
      // mensaje ilegible: se confirma igual, reintentarlo no lo arreglaría
      return;
    }
    const connections = await this.connectionsService.findActiveByEmail(
      notification.emailAddress,
    );
    for (const connection of connections) {
      void this.syncService.syncHistory(connection);
    }
  }

  // Vuelta del consentimiento de Google. Lo autentica el `state` firmado que
  // se generó en gmailAuthUrl.
  @Get('google/callback')
  async googleCallback(
    @Res() res: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    let result: { status: string; reason?: string };
    if (error || !state || !code) {
      result = { status: 'error', reason: error ?? 'missing_code' };
    } else {
      try {
        const connection = await this.connectionsService.connect(state, code);
        result = { status: 'connected', reason: connection.emailAddress };
      } catch (err) {
        this.logger.warn(`Fallo conectando Gmail: ${(err as Error).message}`);
        result = { status: 'error', reason: (err as Error).message };
      }
    }

    const frontend = this.configService.get<string>('FRONTEND_URL');
    if (!frontend) {
      res.status(result.status === 'connected' ? 200 : 400).json(result);
      return;
    }
    const target = new URL('/settings/mail', frontend);
    target.searchParams.set('status', result.status);
    if (result.reason) {
      target.searchParams.set('detail', result.reason);
    }
    res.redirect(target.toString());
  }
}

function decodeNotification(body: PubSubPush): GmailNotification | null {
  const data = body?.message?.data;
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(
      Buffer.from(data, 'base64').toString('utf8'),
    ) as GmailNotification;
  } catch {
    return null;
  }
}

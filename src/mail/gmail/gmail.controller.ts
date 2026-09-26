import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MailConnectionsService } from '../mail-connections.service';

// Rutas públicas por necesidad: a ellas llama Google, no el frontend, así que
// no llevan JWT. Cada una se autentica a su manera.
@Controller('mail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);

  constructor(
    private readonly connectionsService: MailConnectionsService,
    private readonly configService: ConfigService,
  ) {}

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

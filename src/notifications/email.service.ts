import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');
    if (!apiKey || !senderEmail) {
      this.logger.warn('Brevo no está configurado; correo omitido');
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'El servicio de correo no está disponible',
        );
      }
      return;
    }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: this.config.get<string>('BREVO_SENDER_NAME', 'Kairos'),
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!response.ok) {
      this.logger.error(`Brevo respondió ${response.status}`);
      throw new ServiceUnavailableException('No se pudo enviar el correo');
    }
  }
}

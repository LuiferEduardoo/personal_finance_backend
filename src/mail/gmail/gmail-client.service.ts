import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auth, gmail, gmail_v1 } from '@googleapis/gmail';
import { MailAttachment } from '../parsing/attachment-extractor';

// Solo lectura: la app nunca envía, borra ni etiqueta correos.
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Solo se descargan los adjuntos que pueden llevar la factura. El PDF y las
// imágenes de la firma del correo ni se bajan.
const INVOICE_ATTACHMENT = /\.(xml|zip|rar)$/i;
const INVOICE_MIME_TYPES = [
  'application/xml',
  'text/xml',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
];

export type GmailApi = gmail_v1.Gmail;

export interface MessageMeta {
  id: string;
  // dirección del remitente, en minúsculas
  from: string | null;
  subject: string | null;
  receivedAt: Date | null;
}

export interface WatchResult {
  historyId: string;
  expiresAt: Date;
}

// Envoltorio fino sobre el cliente oficial de Gmail. Todo lo que habla con
// Google pasa por aquí, para que el resto del módulo trabaje con tipos
// propios y se pueda probar sin red.
@Injectable()
export class GmailClientService {
  constructor(private readonly configService: ConfigService) {}

  authUrl(state: string): string {
    return this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      // sin prompt=consent Google solo entrega el refresh token la PRIMERA
      // vez; reconectar el mismo buzón quedaría sin token
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state,
    });
  }

  // Canjea el código del callback por el refresh token y averigua de qué
  // buzón es.
  async exchangeCode(
    code: string,
  ): Promise<{ refreshToken: string; emailAddress: string }> {
    const client = this.oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new ServiceUnavailableException(
        'Google no devolvió un refresh token. Revoca el acceso de la app en tu cuenta de Google y vuelve a conectar.',
      );
    }
    client.setCredentials(tokens);
    const profile = await gmail({
      version: 'v1',
      auth: client,
    }).users.getProfile({ userId: 'me' });
    return {
      refreshToken: tokens.refresh_token,
      emailAddress: (profile.data.emailAddress ?? '').toLowerCase(),
    };
  }

  forToken(refreshToken: string): GmailApi {
    const client = this.oauthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return gmail({ version: 'v1', auth: client });
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.oauthClient().revokeToken(refreshToken);
  }

  async currentHistoryId(api: GmailApi): Promise<string> {
    const profile = await api.users.getProfile({ userId: 'me' });
    return String(profile.data.historyId);
  }

  // true si el push está configurado; sin él todo funciona igual, pero los
  // correos nuevos llegan con el job horario en vez de al instante
  get pushConfigured(): boolean {
    return Boolean(this.configService.get<string>('GMAIL_PUBSUB_TOPIC'));
  }

  // Suscribe el buzón al topic de Pub/Sub. Caduca a los 7 días: el cron la
  // renueva antes.
  async watch(api: GmailApi): Promise<WatchResult> {
    const topicName = this.required('GMAIL_PUBSUB_TOPIC');
    const response = await api.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });
    return {
      historyId: String(response.data.historyId),
      expiresAt: new Date(Number(response.data.expiration)),
    };
  }

  async stopWatch(api: GmailApi): Promise<void> {
    await api.users.stop({ userId: 'me' });
  }

  // Ids de los mensajes añadidos desde `startHistoryId`, del más viejo al más
  // nuevo, y el historyId hasta el que se llegó.
  async messagesAddedSince(
    api: GmailApi,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId: string }> {
    const ids = new Set<string>();
    let historyId = startHistoryId;
    let pageToken: string | undefined;
    do {
      const { data } = await api.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
      });
      for (const entry of data.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) {
            ids.add(added.message.id);
          }
        }
      }
      if (data.historyId) {
        historyId = String(data.historyId);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { messageIds: [...ids], historyId };
  }

  // Ids de los mensajes que casan con una búsqueda de Gmail, del más viejo al
  // más nuevo: así el inventario reabre los ciclos en el orden real.
  async searchMessages(api: GmailApi, query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await api.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken,
      });
      for (const message of data.messages ?? []) {
        if (message.id) {
          ids.push(message.id);
        }
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return ids.reverse();
  }

  // Solo cabeceras: basta para decidir si el remitente interesa sin bajar el
  // correo entero.
  async getMeta(api: GmailApi, messageId: string): Promise<MessageMeta> {
    const { data } = await api.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });
    const headers = data.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? null;
    return {
      id: messageId,
      from: parseAddress(header('From')),
      subject: header('Subject'),
      receivedAt: data.internalDate
        ? new Date(Number(data.internalDate))
        : null,
    };
  }

  async getInvoiceAttachments(
    api: GmailApi,
    messageId: string,
  ): Promise<MailAttachment[]> {
    const { data } = await api.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    const attachments: MailAttachment[] = [];
    for (const part of flattenParts(data.payload)) {
      const filename = part.filename ?? '';
      const mimeType = (part.mimeType ?? '').toLowerCase();
      if (
        !INVOICE_ATTACHMENT.test(filename) &&
        !INVOICE_MIME_TYPES.includes(mimeType)
      ) {
        continue;
      }
      // los adjuntos pequeños vienen en línea; los grandes, por id aparte
      let encoded = part.body?.data ?? null;
      if (!encoded && part.body?.attachmentId) {
        const attachment = await api.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: part.body.attachmentId,
        });
        encoded = attachment.data.data ?? null;
      }
      if (encoded) {
        attachments.push({
          filename,
          mimeType,
          data: Buffer.from(encoded, 'base64url'),
        });
      }
    }
    return attachments;
  }

  // Cliente OAuth nuevo por uso: guarda las credenciales en memoria y no debe
  // compartirse entre buzones.
  oauthClient() {
    return new auth.OAuth2(
      this.required('GOOGLE_CLIENT_ID'),
      this.required('GOOGLE_CLIENT_SECRET'),
      this.required('GOOGLE_MAIL_REDIRECT_URI'),
    );
  }

  // Igual que OpenAI y SecretBox: la configuración se exige en el primer uso,
  // no al arrancar, para que el backend levante sin la integración.
  private required(name: string): string {
    const value = this.configService.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(
        `La integración con Gmail no está configurada (falta ${name})`,
      );
    }
    return value;
  }
}

// "D1 SAS <facturacion@d1.com.co>" -> "facturacion@d1.com.co"
export function parseAddress(from: string | null): string | null {
  if (!from) {
    return null;
  }
  const match = /<([^>]+)>/.exec(from);
  const address = (match ? match[1] : from).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

function flattenParts(
  part: gmail_v1.Schema$MessagePart | undefined,
): gmail_v1.Schema$MessagePart[] {
  if (!part) {
    return [];
  }
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

// Gmail responde invalid_grant cuando el usuario revocó el acceso o el token
// caducó: hace falta reconectar, reintentar no sirve.
export function isInvalidGrant(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  const data = (error as { response?: { data?: { error?: string } } })?.response
    ?.data;
  return message.includes('invalid_grant') || data?.error === 'invalid_grant';
}

// Gmail devuelve 404 en history.list cuando el historyId es demasiado viejo
export function isNotFound(error: unknown): boolean {
  const status =
    (error as { status?: number; code?: number | string })?.status ??
    (error as { code?: number | string })?.code;
  return Number(status) === 404;
}

import { ConfigService } from '@nestjs/config';
import {
  GmailApi,
  GmailClientService,
  isInvalidGrant,
  isNotFound,
  parseAddress,
} from './gmail-client.service';

describe('parseAddress', () => {
  it('saca la dirección de un From con nombre', () => {
    expect(parseAddress('D1 S A S <FacturacionElectronica@D1.com.co>')).toBe(
      'facturacionelectronica@d1.com.co',
    );
  });

  it('acepta la dirección sola y rechaza lo que no lo es', () => {
    expect(parseAddress(' ventas@tienda.co ')).toBe('ventas@tienda.co');
    expect(parseAddress('Sin correo')).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});

describe('clasificación de errores de Google', () => {
  it('invalid_grant', () => {
    expect(isInvalidGrant(new Error('invalid_grant'))).toBe(true);
    expect(
      isInvalidGrant({ response: { data: { error: 'invalid_grant' } } }),
    ).toBe(true);
    expect(isInvalidGrant(new Error('timeout'))).toBe(false);
  });

  it('404 de historial caducado', () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ code: '404' })).toBe(true);
    expect(isNotFound({ status: 500 })).toBe(false);
  });
});

describe('adjuntos según el tipo de remitente', () => {
  const inline = (text: string) => ({
    data: Buffer.from(text).toString('base64url'),
  });
  const api = {
    users: {
      messages: {
        get: jest.fn().mockResolvedValue({
          data: {
            payload: {
              parts: [
                {
                  filename: 'confirmacion.pdf',
                  mimeType: 'application/octet-stream',
                  body: inline('pdf-1'),
                },
                {
                  filename: '',
                  mimeType: 'application/pdf',
                  body: inline('pdf-2'),
                },
                {
                  filename: 'factura.xml',
                  mimeType: 'text/xml',
                  body: inline('xml'),
                },
                {
                  filename: 'firma.png',
                  mimeType: 'image/png',
                  body: inline('png'),
                },
              ],
            },
          },
        }),
      },
    },
  } as unknown as GmailApi;
  const client = new GmailClientService({} as ConfigService);

  it('un remitente de facturas no recibe los PDF', async () => {
    const attachments = await client.getInvoiceAttachments(api, 'm1');
    expect(attachments.map((a) => a.filename)).toEqual(['factura.xml']);
  });

  it('los PDF se reconocen por extensión o por tipo', async () => {
    const attachments = await client.getPdfAttachments(api, 'm1');
    expect(attachments.map((a) => a.data.toString())).toEqual([
      'pdf-1',
      'pdf-2',
    ]);
  });
});

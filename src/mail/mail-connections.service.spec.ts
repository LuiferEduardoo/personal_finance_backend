import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { SecretBox } from '../common/crypto/secret-box';
import { MailConnection } from './entities/mail-connection.entity';
import { GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';

const config = {
  get: (name: string, fallback?: string) =>
    name === 'JWT_SECRET' ? 'secreto-de-prueba' : fallback,
} as unknown as ConfigService;

function setup() {
  const jwt = new JwtService({ secret: 'secreto-de-prueba' });
  const gmailClient = {
    authUrl: jest.fn((state: string) => `https://google/auth?state=${state}`),
    exchangeCode: jest.fn().mockRejectedValue(new Error('no debería llegar')),
  };
  const service = new MailConnectionsService(
    {} as Repository<MailConnection>,
    {} as SecretBox,
    gmailClient as unknown as GmailClientService,
    jwt,
    config,
  );
  return { service, jwt, gmailClient };
}

describe('MailConnectionsService: state del OAuth', () => {
  it('firma el state con el usuario y lo acepta al volver', async () => {
    const { service, gmailClient } = setup();
    const url = service.authUrl('user-1');
    const state = new URL(url).searchParams.get('state')!;

    // pasa la verificación y llega al canje del código
    await expect(service.connect(state, 'code')).rejects.toThrow(
      'no debería llegar',
    );
    expect(gmailClient.exchangeCode).toHaveBeenCalledWith('code');
  });

  it('un access token normal NO sirve como state', async () => {
    const { service, jwt, gmailClient } = setup();
    const accessToken = jwt.sign({ sub: 'user-1', purpose: 'gmail-oauth' });
    await expect(service.connect(accessToken, 'code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(gmailClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('un state basura se rechaza', async () => {
    const { service } = setup();
    await expect(service.connect('basura', 'code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

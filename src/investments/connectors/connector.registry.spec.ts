import { BadRequestException } from '@nestjs/common';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { BinanceConnector } from './binance.connector';
import { BrokerConnectorRegistry } from './connector.registry';
import { EtoroConnector } from './etoro.connector';
import { InteractiveBrokersConnector } from './interactive-brokers.connector';
import { XtbConnector } from './xtb.connector';

const registry = new BrokerConnectorRegistry(
  new BinanceConnector(),
  new EtoroConnector(),
  new InteractiveBrokersConnector(),
  new XtbConnector(),
);

describe('BrokerConnectorRegistry: forma de las credenciales', () => {
  // XTB responde "EX000 Invalid parameters" si el userId no es numérico, sin
  // decir por qué. Verificado contra ws.xapi.pro: un userId con letras o con
  // arroba da EX000, uno numérico llega a comprobar la contraseña.
  it('rechaza un correo como userId de XTB', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.XTB, {
        userId: 'alguien@gmail.com',
        password: 'x',
      }),
    ).toThrow(BadRequestException);
  });

  it('el mensaje dice qué poner y dónde encontrarlo', () => {
    try {
      registry.validateCredentials(BrokerKind.XTB, {
        userId: 'alguien@gmail.com',
        password: 'x',
      });
      throw new Error('debería haber lanzado');
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toMatch(/NÚMERO de cuenta/);
      expect(msg).toMatch(/no tu correo/);
      expect(msg).toMatch(/xStation/);
    }
  });

  it('rechaza un userId con letras', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.XTB, {
        userId: 'ABC1234',
        password: 'x',
      }),
    ).toThrow(BadRequestException);
  });

  it('acepta un número de cuenta', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.XTB, {
        userId: '1234567',
        password: 'x',
      }),
    ).not.toThrow();
  });

  it('tolera espacios al borde', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.XTB, {
        userId: '  1234567  ',
        password: 'x',
      }),
    ).not.toThrow();
  });

  it('exige que el queryId de IBKR sea numérico, no el nombre de la query', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.INTERACTIVE_BROKERS, {
        token: 'abc',
        queryId: 'Mi Actividad',
      }),
    ).toThrow(/número de la Flex Query/);
    expect(() =>
      registry.validateCredentials(BrokerKind.INTERACTIVE_BROKERS, {
        token: 'abc',
        queryId: '987654',
      }),
    ).not.toThrow();
  });

  it('no impone forma a los brókers que no la necesitan', () => {
    expect(() =>
      registry.validateCredentials(BrokerKind.BINANCE, {
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).not.toThrow();
    expect(() =>
      registry.validateCredentials(BrokerKind.ETORO, {
        apiKey: 'k',
        userKey: 'u',
      }),
    ).not.toThrow();
  });
});

describe('BrokerConnectorRegistry: soporte por bróker', () => {
  it('reconoce los cuatro conectores', () => {
    for (const broker of [
      BrokerKind.BINANCE,
      BrokerKind.ETORO,
      BrokerKind.INTERACTIVE_BROKERS,
      BrokerKind.XTB,
    ]) {
      expect(registry.supports(broker)).toBe(true);
    }
  });

  it('MANUAL no admite conexión automática', () => {
    expect(registry.supports(BrokerKind.MANUAL)).toBe(false);
    expect(() => registry.get(BrokerKind.MANUAL)).toThrow(
      /Importa el statement por archivo/,
    );
  });

  it('dice qué credenciales pide cada bróker', () => {
    expect(registry.requiredCredentials(BrokerKind.XTB)).toEqual([
      'userId',
      'password',
    ]);
    expect(registry.requiredCredentials(BrokerKind.BINANCE)).toEqual([
      'apiKey',
      'apiSecret',
    ]);
  });
});

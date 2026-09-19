import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrokerKind } from '../../common/enums/broker-kind.enum';
import { BinanceConnector } from './binance.connector';
import { BrokerConnector } from './broker-connector.interface';
import { EtoroConnector } from './etoro.connector';
import { InteractiveBrokersConnector } from './interactive-brokers.connector';
import { XtbConnector } from './xtb.connector';

// Registro de conectores por bróker. Sin módulos dinámicos: se inyectan las
// implementaciones concretas y se indexan, igual de simple que el resto del
// repo.
@Injectable()
export class BrokerConnectorRegistry {
  private readonly connectors: Map<BrokerKind, BrokerConnector>;

  constructor(
    binance: BinanceConnector,
    etoro: EtoroConnector,
    ibkr: InteractiveBrokersConnector,
    xtb: XtbConnector,
  ) {
    this.connectors = new Map<BrokerKind, BrokerConnector>([
      [BrokerKind.BINANCE, binance],
      [BrokerKind.ETORO, etoro],
      [BrokerKind.INTERACTIVE_BROKERS, ibkr],
      [BrokerKind.XTB, xtb],
    ]);
  }

  get(broker: BrokerKind): BrokerConnector {
    const connector = this.connectors.get(broker);
    if (!connector) {
      throw new NotFoundException(
        `El bróker ${broker} no admite conexión automática. Importa el statement por archivo.`,
      );
    }
    return connector;
  }

  supports(broker: BrokerKind): boolean {
    return this.connectors.has(broker);
  }

  // Valida la FORMA de cada credencial, no solo que esté presente.
  //
  // Existe porque los brókers rechazan una credencial mal formada con códigos
  // opacos: XTB, por ejemplo, responde "EX000 Invalid parameters" si el userId
  // no es numérico, sin decir por qué. Es mucho mejor explicarlo aquí.
  validateCredentials(
    broker: BrokerKind,
    credentials: Record<string, unknown>,
  ): void {
    if (broker === BrokerKind.XTB) {
      const userId = String(credentials.userId ?? '').trim();
      if (!/^[0-9]+$/.test(userId)) {
        throw new BadRequestException(
          'El userId de XTB es el NÚMERO de cuenta (solo dígitos), no tu correo ' +
            'electrónico. Lo encuentras en xStation, en Configuración > Detalles ' +
            'de la cuenta, o en el correo de bienvenida de XTB.',
        );
      }
    }
    if (broker === BrokerKind.INTERACTIVE_BROKERS) {
      const queryId = String(credentials.queryId ?? '').trim();
      if (!/^[0-9]+$/.test(queryId)) {
        throw new BadRequestException(
          'El queryId de Interactive Brokers es el número de la Flex Query ' +
            '(solo dígitos), no su nombre. Lo ves en Account Management > ' +
            'Reports > Flex Queries.',
        );
      }
    }
  }

  // qué credenciales pide cada bróker, para que el cliente sepa qué formulario
  // mostrar
  requiredCredentials(broker: BrokerKind): string[] {
    switch (broker) {
      case BrokerKind.BINANCE:
        return ['apiKey', 'apiSecret'];
      case BrokerKind.ETORO:
        return ['apiKey', 'userKey'];
      case BrokerKind.INTERACTIVE_BROKERS:
        return ['token', 'queryId'];
      case BrokerKind.XTB:
        return ['userId', 'password'];
      default:
        return [];
    }
  }
}

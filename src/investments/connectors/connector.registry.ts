import { Injectable, NotFoundException } from '@nestjs/common';
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

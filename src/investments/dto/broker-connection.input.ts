import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import { BrokerKind } from '../../common/enums/broker-kind.enum';

@InputType()
export class CreateBrokerConnectionInput {
  @Field(() => BrokerKind)
  broker: BrokerKind;

  @Field({ description: 'Nombre para distinguirla (ej. "Binance principal")' })
  label: string;

  @Field({ nullable: true, defaultValue: false })
  isDemo?: boolean;

  @Field({ nullable: true, defaultValue: true })
  autoSync?: boolean;

  // Las credenciales ENTRAN por aquí y no vuelven a salir jamás: se cifran al
  // guardarlas y GraphQL no expone ningún campo que las devuelva.
  @Field(() => GraphQLJSON, {
    description:
      'Credenciales del bróker. Binance: apiKey, apiSecret. eToro: apiKey, userKey. ' +
      'IBKR: token, queryId. XTB: userId, password.',
  })
  credentials: Record<string, unknown>;
}

@InputType()
export class UpdateBrokerConnectionInput {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  isDemo?: boolean;

  @Field({ nullable: true })
  autoSync?: boolean;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Solo si quieres reemplazarlas',
  })
  credentials?: Record<string, unknown>;
}

@ObjectType({ description: 'Resultado de sincronizar una conexión' })
export class BrokerSyncReport {
  @Field(() => ID)
  connectionId: string;

  @Field(() => Number, { description: 'Operaciones traídas del bróker' })
  fetched: number;

  @Field(() => Number, { description: 'Operaciones nuevas insertadas' })
  inserted: number;

  @Field(() => Number, {
    description: 'Descartadas por ya estar en el libro',
  })
  duplicates: number;

  @Field(() => [String])
  errors: string[];

  @Field(() => [String])
  warnings: string[];

  @Field({ description: 'true si no se pudo traer todo el periodo' })
  partial: boolean;
}

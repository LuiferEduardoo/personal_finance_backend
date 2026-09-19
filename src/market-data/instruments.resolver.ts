import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import {
  CreateInstrumentInput,
  SetInstrumentPriceInput,
  UpdateInstrumentInput,
} from './dto/create-instrument.input';
import { Instrument } from './entities/instrument.entity';
import { InstrumentsService } from './instruments.service';

// Los instrumentos son datos de referencia globales: cualquier usuario
// autenticado los consulta, pero siguen exigiendo sesión.
@Resolver(() => Instrument)
@UseGuards(GqlAuthGuard)
export class InstrumentsResolver {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Query(() => [Instrument], {
    description: 'Busca instrumentos por ticker o nombre',
  })
  @Scopes(ApiScope.MARKET_DATA_READ)
  instrumentSearch(
    @CurrentUser() _user: Principal,
    @Args('query') query: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 25 })
    limit?: number,
  ): Promise<Instrument[]> {
    return this.instrumentsService.search(query, limit);
  }

  @Query(() => Instrument)
  @Scopes(ApiScope.MARKET_DATA_READ)
  instrument(
    @CurrentUser() _user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Instrument> {
    return this.instrumentsService.findOne(id);
  }

  @Mutation(() => Instrument, {
    description: 'Registra un instrumento nuevo (acción, ETF, cripto, etc.)',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  createInstrument(
    @CurrentUser() _user: Principal,
    @Args('input') input: CreateInstrumentInput,
  ): Promise<Instrument> {
    return this.instrumentsService.create(input);
  }

  @Mutation(() => Instrument)
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  updateInstrument(
    @CurrentUser() _user: Principal,
    @Args('input') input: UpdateInstrumentInput,
  ): Promise<Instrument> {
    return this.instrumentsService.update(input);
  }

  @Mutation(() => Instrument, {
    description:
      'Fija manualmente el precio de cierre de un instrumento para una fecha',
  })
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  setInstrumentPrice(
    @CurrentUser() _user: Principal,
    @Args('input') input: SetInstrumentPriceInput,
  ): Promise<Instrument> {
    return this.instrumentsService.setPrice(input);
  }
}

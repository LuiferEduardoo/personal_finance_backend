import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { assertCurrency } from '../common/currency';
import {
  CreateInstrumentInput,
  SetInstrumentPriceInput,
  UpdateInstrumentInput,
} from './dto/create-instrument.input';
import { InstrumentPrice } from './entities/instrument-price.entity';
import {
  Instrument,
  InstrumentAssetClass,
  InstrumentPriceSource,
} from './entities/instrument.entity';

export interface ResolveInstrumentOptions {
  name?: string;
  exchange?: string | null;
  currency?: string;
  assetClass?: InstrumentAssetClass;
  isin?: string | null;
}

const today = (): string => new Date().toISOString().substring(0, 10);

// Los instrumentos y sus precios son datos de referencia GLOBALES: no llevan
// user_id, así que aquí no hay filtrado por usuario a propósito. Eso es lo que
// hace que el histórico que descarga un usuario sirva para todos.
@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly instrumentsRepository: Repository<Instrument>,
    @InjectRepository(InstrumentPrice)
    private readonly pricesRepository: Repository<InstrumentPrice>,
  ) {}

  async findOne(id: string): Promise<Instrument> {
    const instrument = await this.instrumentsRepository.findOne({
      where: { id },
    });
    if (!instrument) {
      throw new NotFoundException(`Instrumento ${id} no encontrado`);
    }
    return instrument;
  }

  findByIds(ids: string[]): Promise<Instrument[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.instrumentsRepository.find({ where: { id: In(ids) } });
  }

  search(query: string, limit = 25): Promise<Instrument[]> {
    const term = query?.trim();
    if (!term) {
      return Promise.resolve([]);
    }
    return this.instrumentsRepository.find({
      where: [{ symbol: ILike(`%${term}%`) }, { name: ILike(`%${term}%`) }],
      order: { symbol: 'ASC' },
      take: Math.min(limit, 50),
    });
  }

  async create(input: CreateInstrumentInput): Promise<Instrument> {
    const currency = assertCurrency(input.currency);
    const symbol = input.symbol?.trim().toUpperCase();
    if (!symbol) {
      throw new BadRequestException(
        'El símbolo del instrumento es obligatorio',
      );
    }
    const exchange = input.exchange?.trim().toUpperCase() ?? null;

    const existing = await this.instrumentsRepository.findOne({
      where: { symbol, exchange },
    });
    if (existing) {
      throw new BadRequestException(
        `El instrumento ${symbol}${exchange ? ` (${exchange})` : ''} ya existe`,
      );
    }

    const instrument = this.instrumentsRepository.create({
      ...input,
      symbol,
      exchange,
      currency,
      country: input.country?.trim().toUpperCase() ?? null,
      assetClass: input.assetClass ?? InstrumentAssetClass.EQUITY,
      priceSource: InstrumentPriceSource.MANUAL,
      // los benchmarks se refrescan siempre, tenga o no posiciones el usuario
      needsDailyPrice: input.benchmarkKey != null,
    });
    return this.instrumentsRepository.save(instrument);
  }

  async update(input: UpdateInstrumentInput): Promise<Instrument> {
    const instrument = await this.findOne(input.id);
    const { id: _ignored, ...changes } = input;
    void _ignored;
    Object.assign(instrument, changes);
    if (changes.country) {
      instrument.country = changes.country.trim().toUpperCase();
    }
    return this.instrumentsRepository.save(instrument);
  }

  // Busca por símbolo y lo crea si no existe. En la fase 1 no hay proveedor de
  // precios, así que un instrumento nuevo nace con priceSource MANUAL; la fase
  // 2 lo resolverá contra Twelve Data y cacheará el alias.
  async resolveOrCreate(
    symbolHint: string,
    options: ResolveInstrumentOptions = {},
    manager?: EntityManager,
  ): Promise<Instrument> {
    const repository =
      manager?.getRepository(Instrument) ?? this.instrumentsRepository;
    const symbol = symbolHint?.trim().toUpperCase();
    if (!symbol) {
      throw new BadRequestException(
        'El símbolo del instrumento es obligatorio',
      );
    }
    const exchange = options.exchange?.trim().toUpperCase() ?? null;

    const found =
      (await repository.findOne({ where: { symbol, exchange } })) ??
      (await repository.findOne({ where: { symbol } }));
    if (found) {
      return found;
    }

    return repository.save(
      repository.create({
        symbol,
        exchange,
        name: options.name?.trim() || symbol,
        currency: assertCurrency(options.currency ?? 'USD'),
        assetClass: options.assetClass ?? InstrumentAssetClass.EQUITY,
        isin: options.isin ?? null,
        priceSource: InstrumentPriceSource.MANUAL,
      }),
    );
  }

  // --- precios ---

  async setPrice(input: SetInstrumentPriceInput): Promise<Instrument> {
    const instrument = await this.findOne(input.instrumentId);
    if (!Number.isFinite(input.close) || input.close <= 0) {
      throw new BadRequestException('El precio debe ser mayor que 0');
    }
    const priceOn = input.priceOn ?? today();

    await this.pricesRepository
      .createQueryBuilder()
      .insert()
      .into(InstrumentPrice)
      .values({
        instrumentId: instrument.id,
        priceOn,
        close: input.close,
        adjustedClose: input.close,
        currency: instrument.currency,
        source: InstrumentPriceSource.MANUAL,
      })
      .orUpdate(
        ['close', 'adjusted_close', 'source'],
        ['instrument_id', 'price_on'],
      )
      .execute();

    // last_price refleja el precio MÁS RECIENTE, no el último escrito: cargar
    // un cierre viejo no debe pisar la valoración de hoy
    if (!instrument.lastPriceOn || priceOn >= instrument.lastPriceOn) {
      instrument.lastPrice = input.close;
      instrument.lastPriceOn = priceOn;
      instrument.lastSyncedAt = new Date();
      await this.instrumentsRepository.save(instrument);
    }
    return this.findOne(instrument.id);
  }

  // Último cierre conocido en o antes de `asOf` para cada instrumento.
  // DISTINCT ON es la forma barata de hacerlo en Postgres y arrastra el último
  // precio conocido sobre fines de semana y festivos sin lógica extra.
  async latestPrices(
    instrumentIds: string[],
    asOf?: string,
  ): Promise<Map<string, { close: number; priceOn: string }>> {
    const result = new Map<string, { close: number; priceOn: string }>();
    if (instrumentIds.length === 0) {
      return result;
    }
    const rows: { instrument_id: string; close: string; price_on: string }[] =
      await this.pricesRepository.query(
        `
          SELECT DISTINCT ON ("instrument_id")
            "instrument_id", "close", "price_on"
          FROM "instrument_prices"
          WHERE "instrument_id" = ANY($1::uuid[])
            AND ($2::date IS NULL OR "price_on" <= $2::date)
          ORDER BY "instrument_id", "price_on" DESC
        `,
        [instrumentIds, asOf ?? null],
      );
    for (const row of rows) {
      result.set(row.instrument_id, {
        close: Number(row.close),
        priceOn: row.price_on,
      });
    }
    return result;
  }

  // marca qué instrumentos hay que refrescar cada noche: los que alguien tiene
  // en cartera hoy más los benchmarks. Es el racionamiento del presupuesto.
  async refreshNeedsDailyPrice(): Promise<number> {
    const result = await this.instrumentsRepository.query(`
      UPDATE "instruments" i
      SET "needs_daily_price" = (
        i."benchmark_key" IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM "investment_positions" p
          WHERE p."instrument_id" = i."id" AND p."quantity" <> 0
        )
      )
      WHERE "needs_daily_price" <> (
        i."benchmark_key" IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM "investment_positions" p
          WHERE p."instrument_id" = i."id" AND p."quantity" <> 0
        )
      )
    `);
    return Array.isArray(result) ? (result[1] ?? 0) : 0;
  }
}

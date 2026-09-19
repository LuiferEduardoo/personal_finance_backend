import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  CorporateActionType,
  InstrumentCorporateAction,
} from './entities/instrument-corporate-action.entity';
import { Instrument } from './entities/instrument.entity';
import { InstrumentsService } from './instruments.service';
import {
  MarketDataBudgetExhaustedError,
  MarketDataRateLimiter,
} from './rate-limiter.service';
import { TwelveDataClient } from './twelve-data.client';

const today = (): string => new Date().toISOString().substring(0, 10);

export interface CorporateActionsReport {
  instruments: number;
  dividends: number;
  splits: number;
  budgetExhausted: boolean;
}

// Descarga dividendos y splits anunciados.
//
// Se consulta MENSUALMENTE y solo para los instrumentos que alguien tiene en
// cartera: son 2 créditos por instrumento, y el presupuesto diario es de 800.
@Injectable()
export class CorporateActionsService {
  private readonly logger = new Logger(CorporateActionsService.name);

  constructor(
    @InjectRepository(Instrument)
    private readonly instrumentsRepository: Repository<Instrument>,
    @InjectRepository(InstrumentCorporateAction)
    private readonly actionsRepository: Repository<InstrumentCorporateAction>,
    private readonly client: TwelveDataClient,
    private readonly limiter: MarketDataRateLimiter,
    private readonly instrumentsService: InstrumentsService,
  ) {}

  async refresh(from = '2015-01-01'): Promise<CorporateActionsReport> {
    const report: CorporateActionsReport = {
      instruments: 0,
      dividends: 0,
      splits: 0,
      budgetExhausted: false,
    };
    if (!this.client.configured) {
      return report;
    }

    // se recalcula primero QUÉ instrumentos están en cartera: la bandera la
    // mantiene el job nocturno, y sin esto una llamada manual solo vería los
    // benchmarks
    await this.instrumentsService.refreshNeedsDailyPrice();

    const instruments = await this.instrumentsRepository.find({
      where: { needsDailyPrice: true },
    });

    for (const instrument of instruments) {
      const symbol = instrument.twelveDataSymbol ?? instrument.symbol;
      try {
        const dividends = await this.limiter.schedule(1, () =>
          this.client.dividends(symbol, from, today()),
        );
        for (const dividend of dividends) {
          await this.upsert({
            instrumentId: instrument.id,
            type: CorporateActionType.DIVIDEND,
            exDate: dividend.exDate,
            amount: dividend.amount,
            currency: instrument.currency,
          });
        }
        report.dividends += dividends.length;

        const splits = await this.limiter.schedule(1, () =>
          this.client.splits(symbol, from, today()),
        );
        for (const split of splits) {
          await this.upsert({
            instrumentId: instrument.id,
            type: CorporateActionType.SPLIT,
            exDate: split.date,
            ratioNumerator: split.numerator,
            ratioDenominator: split.denominator,
            description: split.description,
          });
        }
        report.splits += splits.length;
        report.instruments += 1;
      } catch (error) {
        if (error instanceof MarketDataBudgetExhaustedError) {
          report.budgetExhausted = true;
          this.logger.warn(error.message);
          break;
        }
        this.logger.warn(
          `No se pudieron traer acciones corporativas de ${symbol}: ${(error as Error).message}`,
        );
      }
    }
    return report;
  }

  findForInstruments(
    instrumentIds: string[],
    since?: string,
  ): Promise<InstrumentCorporateAction[]> {
    if (instrumentIds.length === 0) {
      return Promise.resolve([]);
    }
    const query = this.actionsRepository
      .createQueryBuilder('action')
      .leftJoinAndSelect('action.instrument', 'instrument')
      .where('action.instrument_id IN (:...ids)', { ids: instrumentIds })
      .orderBy('action.ex_date', 'DESC');
    if (since) {
      query.andWhere('action.ex_date >= :since', { since });
    }
    return query.getMany();
  }

  findOne(id: string): Promise<InstrumentCorporateAction | null> {
    return this.actionsRepository.findOne({
      where: { id },
      relations: { instrument: true },
    });
  }

  async benchmarksAndHeld(): Promise<Instrument[]> {
    return this.instrumentsRepository.find({
      where: [{ needsDailyPrice: true }, { benchmarkKey: Not(IsNull()) }],
    });
  }

  private async upsert(
    action: Partial<InstrumentCorporateAction>,
  ): Promise<void> {
    await this.actionsRepository
      .createQueryBuilder()
      .insert()
      .into(InstrumentCorporateAction)
      .values(action)
      .orUpdate(
        ['amount', 'ratio_numerator', 'ratio_denominator', 'description'],
        ['instrument_id', 'type', 'ex_date'],
      )
      .execute();
  }
}

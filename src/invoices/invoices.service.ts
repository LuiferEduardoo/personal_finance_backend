import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import OpenAI from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { Repository } from 'typeorm';
import { ArticleType } from '../articles/entities/article.entity';
import { UnitOfMeasure } from '../common/enums/unit-of-measure.enum';
import { ExpenseDraft } from './dto/expense-draft.dto';
import {
  InvoiceAnalysis,
  InvoiceSource,
} from './entities/invoice-analysis.entity';

// Instrucción para GPT-4o: extraer los datos de una factura y devolverlos con
// la forma de un borrador de gasto (ExpenseDraft).
const SYSTEM_PROMPT = `Eres un asistente que extrae los datos de una factura (recibo de compra) y los devuelve como un borrador de gasto en JSON.

Reglas:
- "merchant": el nombre de la tienda o comercio; null si no se identifica.
- "occurredOn": la fecha de la factura en formato YYYY-MM-DD; null si no aparece.
- "currency": el código ISO de 3 letras de la moneda; usa "COP" si no se indica.
- "description": un resumen corto del gasto, por ejemplo "Compra en <tienda>".
- "categorySuggestion": una categoría sugerida en español (p. ej. "Supermercado", "Restaurante", "Transporte", "Salud"); null si no puedes inferirla.
- "items": una línea por cada artículo de la factura. Cada línea:
  - "newArticle.name": el nombre del artículo tal como aparece.
  - "newArticle.type": "product" para bienes físicos, "service" para servicios, "other" en otro caso.
  - "newArticle.unit": una de unit, g, kg, ml, l, pack, roll, pair, other. Usa "unit" si no está claro.
  - "newArticle.brand": la marca si se distingue, si no null.
  - "unitPrice": el precio por unidad (número, sin símbolos de moneda).
  - "quantity": la cantidad (número); usa 1 si no se indica.
  - "description": null salvo que haya una nota útil en la línea.
- "amount": déjalo en null si "items" tiene elementos. Solo si la factura no detalla líneas y solo muestra un total, pon "items": [] y "amount" igual al total.
- No inventes artículos ni precios que no estén en la factura. Devuelve números sin separadores de miles ni símbolos.`;

// JSON Schema para structured outputs: garantiza que la respuesta tenga
// exactamente la forma de ExpenseDraft.
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    merchant: { type: ['string', 'null'] },
    occurredOn: { type: ['string', 'null'] },
    currency: { type: 'string' },
    amount: { type: ['number', 'null'] },
    categorySuggestion: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          newArticle: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: Object.values(ArticleType),
              },
              unit: {
                type: 'string',
                enum: Object.values(UnitOfMeasure),
              },
              brand: { type: ['string', 'null'] },
            },
            required: ['name', 'type', 'unit', 'brand'],
          },
          unitPrice: { type: 'number' },
          quantity: { type: 'number' },
          description: { type: ['string', 'null'] },
        },
        required: ['newArticle', 'unitPrice', 'quantity', 'description'],
      },
    },
  },
  required: [
    'description',
    'merchant',
    'occurredOn',
    'currency',
    'amount',
    'categorySuggestion',
    'items',
  ],
} as const;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private client?: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(InvoiceAnalysis)
    private readonly analysesRepository: Repository<InvoiceAnalysis>,
  ) {}

  // Cliente de OpenAI perezoso: no se exige OPENAI_API_KEY al arrancar la app
  // (para no bloquear el resto de funcionalidades), solo al usar estos
  // endpoints.
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new ServiceUnavailableException(
          'El análisis de facturas no está configurado (falta OPENAI_API_KEY)',
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  private get model(): string {
    return this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  // Analiza una imagen de factura, guarda el análisis y devuelve el borrador.
  async analyzeImage(
    userId: string,
    image: Buffer,
    mimeType: string,
  ): Promise<ExpenseDraft> {
    const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`;
    const result = await this.extract([
      { type: 'text', text: 'Extrae los datos de esta factura.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]);
    await this.saveAnalysis({
      userId,
      source: InvoiceSource.IMAGE,
      imageData: image,
      imageMimeType: mimeType,
      result,
    });
    return result;
  }

  // Analiza el texto de una factura, guarda el análisis y devuelve el borrador.
  async analyzeText(userId: string, text: string): Promise<ExpenseDraft> {
    const result = await this.extract([
      { type: 'text', text: `Extrae los datos de esta factura:\n\n${text}` },
    ]);
    await this.saveAnalysis({
      userId,
      source: InvoiceSource.TEXT,
      inputText: text,
      result,
    });
    return result;
  }

  private async saveAnalysis(
    data: Partial<InvoiceAnalysis> & {
      userId: string;
      source: InvoiceSource;
      result: ExpenseDraft;
    },
  ): Promise<void> {
    try {
      await this.analysesRepository.save(
        this.analysesRepository.create({ model: this.model, ...data }),
      );
    } catch (error) {
      // no se rompe la respuesta al usuario si falla el guardado del histórico
      this.logger.error(
        'No se pudo guardar el análisis de factura',
        error as Error,
      );
    }
  }

  private async extract(
    content: ChatCompletionContentPart[],
  ): Promise<ExpenseDraft> {
    const client = this.getClient();
    let raw: string | null | undefined;
    try {
      const completion = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'expense_draft',
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      });
      raw = completion.choices[0]?.message?.content;
    } catch (error) {
      this.logger.error('Error llamando a OpenAI', error as Error);
      throw new BadGatewayException(
        'No se pudo analizar la factura con el servicio de IA',
      );
    }

    if (!raw) {
      throw new BadGatewayException(
        'El servicio de IA no devolvió ningún resultado',
      );
    }

    let parsed: Omit<ExpenseDraft, 'accountId'>;
    try {
      parsed = JSON.parse(raw) as Omit<ExpenseDraft, 'accountId'>;
    } catch {
      throw new BadGatewayException(
        'El servicio de IA devolvió un resultado con formato inválido',
      );
    }

    return this.normalize(parsed);
  }

  // Aplica las mismas reglas que valida el server al crear un gasto:
  // con ítems, el importe se recalcula (amount = null); accountId lo pone
  // el usuario más tarde.
  private normalize(draft: Omit<ExpenseDraft, 'accountId'>): ExpenseDraft {
    const items = draft.items ?? [];
    return {
      ...draft,
      currency: draft.currency || 'COP',
      amount: items.length > 0 ? null : draft.amount,
      items,
      accountId: null,
    };
  }
}

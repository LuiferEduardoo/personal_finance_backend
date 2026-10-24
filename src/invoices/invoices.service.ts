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
import { CategoryClassifierService } from '../categorization/category-classifier.service';
import { ExpenseDraft } from './dto/expense-draft.dto';
import {
  amountsMatch,
  ExtractedItem,
  lineSubtotal,
  reconcileItems,
} from './draft-reconciliation';
import {
  InvoiceAnalysis,
  InvoiceSource,
} from './entities/invoice-analysis.entity';

// Instrucción para GPT-4o: extraer los datos de una factura y devolverlos con
// la forma de un borrador de gasto (ExpenseDraft). Las facturas son casi
// siempre colombianas, así que se explica su formato de números.
const SYSTEM_PROMPT = `Eres un asistente que extrae los datos de una factura (recibo de compra) y los devuelve como un borrador de gasto en JSON.

Formato de números (facturas colombianas):
- El punto separa miles y la coma separa decimales: "3.500" = 3500, "12.990,50" = 12990.5, "1.234.567" = 1234567.
- En cantidades de productos pesados la coma también es decimal: "0,456" kg = 0.456.
- Devuelve los números sin separadores de miles ni símbolos de moneda, con punto decimal.

Reglas:
- "merchant": el nombre de la tienda o comercio; null si no se identifica.
- "occurredOn": la fecha de la factura en formato YYYY-MM-DD; null si no aparece.
- "currency": el código ISO de 3 letras de la moneda; usa "COP" si no se indica.
- "description": un resumen corto del gasto, por ejemplo "Compra en <tienda>".
- "categorySuggestion": una categoría sugerida en español (p. ej. "Supermercado", "Restaurante", "Transporte", "Salud"); null si no puedes inferirla.
- "total": el total a pagar de la factura tal como aparece impreso; null si no aparece.
- "items": una línea por cada artículo de la factura. Cada línea:
  - "newArticle.name": el nombre del artículo tal como aparece.
  - "newArticle.type": "product" para bienes físicos, "service" para servicios, "other" en otro caso.
  - "newArticle.unit": una de unit, g, kg, ml, l, pack, roll, pair, other. Usa "kg" o "g" en productos pesados y "unit" si no está claro.
  - "newArticle.brand": la marca si se distingue, si no null.
  - "quantity": la cantidad (número); en productos pesados es el peso (p. ej. 0.456). Usa 1 si no se indica.
  - "unitPrice": el precio de UNA unidad (o de un kg/g en productos pesados), NO el total de la línea. Si la factura solo muestra el total de la línea, pon null: se calculará como lineTotal / quantity.
  - "lineTotal": el importe total impreso en la línea (lo que se paga por esa línea, ya con su descuento); null si no aparece.
  - "discount": el descuento en importe aplicado a esa línea (número positivo), incluidas líneas de descuento que van justo debajo del artículo; null si no hay. No lo restes de "unitPrice".
  - "description": null salvo que haya una nota útil en la línea.
  - Debe cumplirse unitPrice * quantity - discount = lineTotal. Ejemplo: "2 x 3.500 = 7.000" es quantity 2, unitPrice 3500, lineTotal 7000.
- "amount": déjalo en null si "items" tiene elementos. Solo si la factura no detalla líneas y solo muestra un total, pon "items": [] y "amount" igual al total.
- No inventes artículos ni precios que no estén en la factura. No ajustes los números para que cuadren: copia lo que está impreso.`;

const NULLABLE_NUMBER = { type: ['number', 'null'] } as const;

// JSON Schema para structured outputs: garantiza que la respuesta tenga
// exactamente la forma de ExpenseDraft (sin los campos que se calculan aquí).
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    merchant: { type: ['string', 'null'] },
    occurredOn: { type: ['string', 'null'] },
    currency: { type: 'string' },
    amount: NULLABLE_NUMBER,
    total: NULLABLE_NUMBER,
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
          unitPrice: NULLABLE_NUMBER,
          quantity: { type: 'number' },
          lineTotal: NULLABLE_NUMBER,
          discount: NULLABLE_NUMBER,
          description: { type: ['string', 'null'] },
        },
        required: [
          'newArticle',
          'unitPrice',
          'quantity',
          'lineTotal',
          'discount',
          'description',
        ],
      },
    },
  },
  required: [
    'description',
    'merchant',
    'occurredOn',
    'currency',
    'amount',
    'total',
    'categorySuggestion',
    'items',
  ],
} as const;

// lo que devuelve GPT-4o: el borrador sin lo que se decide en código
type ExtractedDraft = Omit<
  ExpenseDraft,
  'accountId' | 'categoryId' | 'warnings' | 'items'
> & { items: ExtractedItem[] };

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private client?: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(InvoiceAnalysis)
    private readonly analysesRepository: Repository<InvoiceAnalysis>,
    private readonly classifier: CategoryClassifierService,
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
    const result = await this.categorize(
      userId,
      await this.extract([
        { type: 'text', text: 'Extrae los datos de esta factura.' },
        // detalle alto: los precios y cantidades son texto pequeño
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ]),
    );
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
    const result = await this.categorize(
      userId,
      await this.extract([
        { type: 'text', text: `Extrae los datos de esta factura:\n\n${text}` },
      ]),
    );
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
        // extracción determinista: no se quiere creatividad con los números
        temperature: 0,
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

    let parsed: ExtractedDraft;
    try {
      parsed = JSON.parse(raw) as ExtractedDraft;
    } catch {
      throw new BadGatewayException(
        'El servicio de IA devolvió un resultado con formato inválido',
      );
    }

    return this.normalize(parsed);
  }

  // Aplica las mismas reglas que valida el server al crear un gasto:
  // con ítems, el importe se recalcula (amount = null); accountId lo pone
  // el usuario más tarde. Además cuadra líneas y total (ver
  // `reconcileItems`) y deja los descuadres en `warnings`.
  private normalize(draft: ExtractedDraft): ExpenseDraft {
    const total = draft.total ?? null;
    const { items, warnings } = reconcileItems(draft.items ?? [], total);
    // sin líneas, el total impreso es el importe si el modelo no lo puso
    const amount = items.length > 0 ? null : (draft.amount ?? total);
    if (
      items.length === 0 &&
      draft.amount != null &&
      total != null &&
      !amountsMatch(draft.amount, total)
    ) {
      warnings.push(
        `El importe leído (${draft.amount}) no coincide con el total de la factura (${total}).`,
      );
    }
    if (items.length === 0 && amount == null) {
      warnings.push(
        'No se pudo leer el total de la factura; indica el importe antes de guardar.',
      );
    }
    return {
      ...draft,
      currency: draft.currency || 'COP',
      amount,
      total,
      categoryId: null,
      items,
      accountId: null,
      warnings,
    };
  }

  // Sugiere categorías con Jev para el gasto y cada artículo nuevo. El
  // clasificador nunca lanza: si falla, el borrador sale sin categorías y el
  // análisis no se pierde.
  private async categorize(
    userId: string,
    draft: ExpenseDraft,
  ): Promise<ExpenseDraft> {
    const result = await this.classifier.classify({
      userId,
      merchant: draft.merchant,
      items: draft.items.map((item, index) => ({
        key: String(index),
        name: item.newArticle.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal ?? lineSubtotal(item),
      })),
    });
    return {
      ...draft,
      categoryId: result.expenseCategoryId,
      items: draft.items.map((item, index) => ({
        ...item,
        newArticle: {
          ...item.newArticle,
          categoryId: result.items[String(index)] ?? null,
        },
      })),
    };
  }
}

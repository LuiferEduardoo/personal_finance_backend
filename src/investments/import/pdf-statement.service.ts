import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import { InvestmentTransactionType } from '../../common/enums/investment-transaction-type.enum';
import { InvestmentTransactionDraft } from '../dto/import-batch-draft.dto';
import {
  PDF_RESPONSE_SCHEMA,
  PDF_SYSTEM_PROMPT,
  PdfExtractedTransaction,
} from './pdf-prompt';

// Un statement largo se trocea para no mandar 200 páginas en una sola llamada.
const CHARS_PER_CHUNK = 12_000;
const MAX_CHUNKS = 20;
// Por debajo de esto el PDF no tiene capa de texto: es un escaneo.
const MIN_TEXT_LENGTH = 40;

// Extrae operaciones de un PDF. Determinista primero, LLM después:
// pdf-parse saca el texto y, si el statement no tiene una forma tabular
// reconocible, se cae a GPT-4o con structured outputs reutilizando el mismo
// patrón que InvoicesService.
//
// Un PDF escaneado se RECHAZA con un mensaje claro en vez de intentar OCR:
// el OCR está fuera del alcance y adivinar cifras de un escaneo es peor que
// pedirle al usuario el CSV.
@Injectable()
export class PdfStatementService {
  private readonly logger = new Logger(PdfStatementService.name);
  private client: OpenAI | null = null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o';
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new ServiceUnavailableException(
          'El análisis de PDF no está configurado (falta OPENAI_API_KEY)',
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  // pdf-parse v2 expone una clase, no la función por defecto de la v1.
  // El parser hay que destruirlo siempre: deja un worker de pdfjs vivo.
  async extractText(buffer: Buffer): Promise<{ text: string; pages: number }> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    let raw = '';
    let pages = 0;
    try {
      const result = await parser.getText();
      raw = result.text ?? '';
      pages = result.pages?.length ?? 0;
    } catch (error) {
      throw new BadRequestException(
        `No se pudo leer el PDF: ${(error as Error).message}`,
      );
    } finally {
      await parser.destroy().catch(() => undefined);
    }

    // pdf-parse intercala separadores "-- 1 of 12 --" entre páginas; estorban
    // al modelo y no aportan nada
    const text = raw.replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '').trim();

    if (text.length < MIN_TEXT_LENGTH) {
      throw new BadRequestException(
        'El PDF no tiene texto extraíble (parece escaneado). ' +
          'Exporta el statement en CSV o XLSX desde tu bróker.',
      );
    }
    return { text, pages };
  }

  // Trocea por saltos de línea para no partir una operación por la mitad.
  chunk(text: string): string[] {
    const lines = text.split('\n');
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      if (current.length + line.length > CHARS_PER_CHUNK && current) {
        chunks.push(current);
        current = '';
      }
      current += `${line}\n`;
    }
    if (current.trim()) {
      chunks.push(current);
    }
    return chunks.slice(0, MAX_CHUNKS);
  }

  async extractTransactions(buffer: Buffer): Promise<{
    rows: InvestmentTransactionDraft[];
    pages: number;
    chunks: number;
  }> {
    const { text, pages } = await this.extractText(buffer);
    const chunks = this.chunk(text);
    const extracted: PdfExtractedTransaction[] = [];

    for (const piece of chunks) {
      extracted.push(...(await this.askModel(piece)));
    }

    return {
      rows: extracted.map((row, index) => this.toDraft(row, index + 1)),
      pages,
      chunks: chunks.length,
    };
  }

  private async askModel(text: string): Promise<PdfExtractedTransaction[]> {
    const client = this.getClient();
    let raw: string | null | undefined;
    try {
      const completion = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: PDF_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'investment_transactions',
            strict: true,
            schema: PDF_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });
      raw = completion.choices[0]?.message?.content;
    } catch (error) {
      this.logger.error('Error llamando a OpenAI', error as Error);
      throw new BadGatewayException(
        'No se pudo analizar el PDF con el servicio de IA',
      );
    }

    if (!raw) {
      throw new BadGatewayException(
        'El servicio de IA no devolvió ningún resultado',
      );
    }
    try {
      const parsed = JSON.parse(raw) as {
        transactions?: PdfExtractedTransaction[];
      };
      return parsed.transactions ?? [];
    } catch {
      throw new BadGatewayException(
        'El servicio de IA devolvió un resultado con formato inválido',
      );
    }
  }

  // Lo que sale del modelo entra al MISMO borrador que el CSV y el XLSX, con
  // los mismos avisos: no hay un camino paralelo con reglas propias.
  private toDraft(
    row: PdfExtractedTransaction,
    rowNumber: number,
  ): InvestmentTransactionDraft {
    const errors: string[] = [];
    const type = Object.values(InvestmentTransactionType).find(
      (value) => value === row.type,
    );
    if (!type) {
      errors.push(`Tipo de operación no reconocido: "${row.type}"`);
    }
    if (!row.occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn)) {
      errors.push('No se pudo leer la fecha');
    }

    // el modelo puede devolver signo pese a la instrucción; se normaliza igual
    const quantity = row.quantity === null ? null : Math.abs(row.quantity);
    const amount = row.amount === null ? null : Math.abs(row.amount);

    return {
      rowNumber,
      type: type ?? null,
      occurredOn: row.occurredOn,
      occurredAt: null,
      symbol: row.symbol,
      sector: null,
      isin: row.isin,
      instrumentId: null,
      // el instrumento lo resuelve ImportService con el mismo caché que el
      // resto de formatos
      needsInstrument: false,
      quantity,
      price: row.price === null ? null : Math.abs(row.price),
      amount,
      fee: Math.abs(row.fee ?? 0),
      tax: Math.abs(row.tax ?? 0),
      currency: row.currency,
      externalId: row.externalId,
      notes: row.notes,
      isDuplicate: false,
      errors,
      raw: { source: 'pdf', ...(row as unknown as Record<string, string>) },
    };
  }
}

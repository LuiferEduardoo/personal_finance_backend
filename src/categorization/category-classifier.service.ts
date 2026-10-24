import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  choice,
  noul,
  type ChoiceQuestion,
  type JsonValue,
  type NoulQuestion,
  TypeSafeClient,
} from '@typesafe-ai/sdk';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/entities/category.entity';
import { TransactionKind } from '../common/enums/transaction-kind.enum';

// Clasificación de gastos en categorías con Jev, el modelo de clasificación
// de TypeSafe. NO es un LLM: responde preguntas cerradas (choice/noul) con
// probabilidades, y las decisiones se toman aquí, en código, con umbrales.
//
// Nunca lanza: sin clave, con más categorías de las que admite un choice o
// ante cualquier error de la API devuelve "sin clasificación" y el gasto se
// registra igual.

const DEFAULT_MODEL = 'jev-1.14.0';

// Un choice admite de 1 a 255 opciones.
const MAX_CHOICE_OPTIONS = 255;

// Se acepta la opción más probable a partir de esta confianza
// (confianza = (pmax - 1/n) / (1 - 1/n), la que reporta la API).
export const CHOICE_CONFIDENCE_THRESHOLD = 0.6;
// Si ninguna opción gana pero la masa de probabilidad de una misma rama
// (el padre y sus hijas) llega a esto, se usa el padre.
export const PARENT_MASS_THRESHOLD = 0.8;
// Con categoría por defecto, Jev solo la reemplaza si el noul "¿la compra
// pertenece a la categoría por defecto?" queda por debajo de esto. En la
// franja intermedia se conserva la del usuario.
export const DEFAULT_REJECT_NOUL_THRESHOLD = 0.3;

// Tiempo por intento y presupuesto total: el análisis por foto espera esta
// respuesta, así que no se deja que los reintentos del SDK se alarguen.
const ATTEMPT_TIMEOUT_MS = 10_000;
const TOTAL_BUDGET_MS = 20_000;
const MAX_RETRIES = 1;

const LABEL_SEPARATOR = ' > ';
const PURCHASE_QUESTION = 'purchase';
const DEFAULT_QUESTION = 'default_fit';

export interface ClassifiableItem {
  // identificador del caller (índice de la línea, id del artículo...)
  key: string;
  name: string;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  // false = el ítem solo da contexto a la compra (p. ej. su artículo ya
  // tiene categoría) y no se pregunta por él
  classify?: boolean;
}

export interface ClassifyInput {
  userId: string;
  merchant: string | null;
  items: ClassifiableItem[];
  defaultCategoryId?: string | null;
}

// Una decisión: la categoría elegida (o null) y por qué.
export interface CategoryDecision {
  categoryId: string | null;
  // 'choice' = la opción más probable superó el umbral; 'parent' = se subió
  // al padre por masa de probabilidad
  via: 'choice' | 'parent' | null;
  label: string | null;
  confidence: number;
}

export interface ClassificationResult {
  // false si no se llegó a preguntar a Jev (sin clave, sin categorías, error)
  classified: boolean;
  // categoryId por `key` de cada ítem preguntado (null = sin decisión)
  items: Record<string, string | null>;
  invoiceCategoryId: string | null;
  // la categoría final del gasto: la por defecto salvo que Jev la descarte
  // con claridad (ver `resolveExpenseCategory`)
  expenseCategoryId: string | null;
  // señales crudas para que el caller las registre en el log
  signals: {
    items: Record<string, CategoryDecision>;
    invoice: CategoryDecision | null;
    defaultNoul: number | null;
  };
}

interface CategoryOption {
  id: string;
  parentId: string | null;
  label: string;
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Readonly<Record<string, number>>;
}

@Injectable()
export class CategoryClassifierService {
  private readonly logger = new Logger(CategoryClassifierService.name);
  private client?: TypeSafeClient;
  // el aviso de "sin clave" sale una vez, no en cada factura
  private warnedMissingKey = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly categoriesService: CategoriesService,
  ) {}

  // Cliente perezoso, igual que el de OpenAI en InvoicesService: no se exige
  // TYPESAFE_API_KEY al arrancar. Devuelve null si no está configurado.
  private getClient(): TypeSafeClient | null {
    if (!this.client) {
      const apiKey = this.configService.get<string>('TYPESAFE_API_KEY');
      if (!apiKey) {
        return null;
      }
      this.client = new TypeSafeClient({
        apiKey,
        defaultModel: this.configService.get<string>(
          'TYPESAFE_MODEL',
          DEFAULT_MODEL,
        ),
        timeout: ATTEMPT_TIMEOUT_MS,
        retry: { maxRetries: MAX_RETRIES },
      });
    }
    return this.client;
  }

  async classify(input: ClassifyInput): Promise<ClassificationResult> {
    const fallback = unclassified(input.defaultCategoryId ?? null);
    try {
      return (await this.run(input)) ?? fallback;
    } catch (error) {
      this.logger.warn(
        `No se pudo clasificar la compra con Jev: ${(error as Error).message}`,
      );
      return fallback;
    }
  }

  private async run(
    input: ClassifyInput,
  ): Promise<ClassificationResult | null> {
    const client = this.getClient();
    if (!client) {
      if (!this.warnedMissingKey) {
        this.warnedMissingKey = true;
        this.logger.warn(
          'Clasificación de categorías desactivada (falta TYPESAFE_API_KEY)',
        );
      }
      return null;
    }

    const categories = await this.categoriesService.findAll(
      input.userId,
      TransactionKind.EXPENSE,
    );
    if (categories.length === 0 || categories.length > MAX_CHOICE_OPTIONS) {
      this.logger.warn(
        `Se omite la clasificación: el usuario tiene ${categories.length} categorías de gasto (se admiten de 1 a ${MAX_CHOICE_OPTIONS})`,
      );
      return null;
    }

    const options = buildOptions(categories);
    const byLabel = new Map(options.map((option) => [option.label, option]));
    const criteria = Object.fromEntries(
      options.map((option) => [option.label, null]),
    );
    const defaultOption = input.defaultCategoryId
      ? options.find((option) => option.id === input.defaultCategoryId)
      : undefined;

    // el estado lleva claves en inglés (el idioma que mejor maneja Jev); los
    // nombres de artículos y categorías quedan en español. El contexto evita
    // que lea en inglés nombres cortos ("Pan" se confundía con un sartén)
    const state: Record<string, JsonValue> = {
      context: 'Purchase invoice from Colombia; item names are in Spanish.',
      merchant: input.merchant,
      items: input.items.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? null,
        unit_price: item.unitPrice ?? null,
        line_total: item.lineTotal ?? null,
      })),
    };

    const questions: Record<string, ChoiceQuestion | NoulQuestion> = {};
    const itemQuestions = new Map<string, string>();
    input.items.forEach((item, index) => {
      if (item.classify === false) {
        return;
      }
      const id = `item_${index}`;
      itemQuestions.set(item.key, id);
      questions[id] = choice(
        `Which expense category does the item \`items[${index}]\` belong to? Judge the item itself, not the rest of the purchase.`,
        criteria,
      );
    });
    questions[PURCHASE_QUESTION] = choice(
      'Which expense category best describes the purchase as a whole? Consider the `merchant` and every entry in `items` together.',
      criteria,
    );
    if (defaultOption) {
      // la categoría por defecto va solo en esta pregunta y no en el estado:
      // en el estado sesgaba los choices de los ítems y de la compra hacia ella
      questions[DEFAULT_QUESTION] = noul({
        default_category: defaultOption.label,
        question:
          'Does the purchase as a whole, given the `merchant` and every entry in `items`, belong to `default_category`?',
      });
    }

    // una sola petición por factura: las preguntas se responden en paralelo
    const { answers } = await client.systemOne(
      { state, questions },
      { signal: AbortSignal.timeout(TOTAL_BUDGET_MS) },
    );

    const items: Record<string, string | null> = {};
    const itemSignals: Record<string, CategoryDecision> = {};
    for (const [key, id] of itemQuestions) {
      const decision = decideCategory(answers[id] as ChoiceAnswer, byLabel);
      items[key] = decision.categoryId;
      itemSignals[key] = decision;
    }
    const invoice = decideCategory(
      answers[PURCHASE_QUESTION] as ChoiceAnswer,
      byLabel,
    );
    const defaultNoul = defaultOption
      ? ((answers[DEFAULT_QUESTION] as { noul?: number } | undefined)?.noul ??
        null)
      : null;

    return {
      classified: true,
      items,
      invoiceCategoryId: invoice.categoryId,
      expenseCategoryId: resolveExpenseCategory(
        input.defaultCategoryId ?? null,
        invoice.categoryId,
        defaultNoul,
      ),
      signals: { items: itemSignals, invoice, defaultNoul },
    };
  }
}

function unclassified(defaultCategoryId: string | null): ClassificationResult {
  return {
    classified: false,
    items: {},
    invoiceCategoryId: null,
    expenseCategoryId: defaultCategoryId,
    signals: { items: {}, invoice: null, defaultNoul: null },
  };
}

/**
 * Etiquetas con la jerarquía ("Alimentación > Mercado") para que Jev
 * distinga una subcategoría de su homónima en otra rama. Si dos categorías
 * acaban con la misma etiqueta (una del sistema y otra del usuario con el
 * mismo nombre), se numeran para que cada etiqueta vuelva a un único id.
 * Se ordenan alfabéticamente para que el orden sea estable entre llamadas.
 */
export function buildOptions(categories: Category[]): CategoryOption[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = (category: Category): string => {
    const names = [category.name.trim()];
    const seen = new Set([category.id]);
    let parent = category.parentId ? byId.get(category.parentId) : undefined;
    // un padre inactivo no se carga: la ruta empieza en el primer ancestro
    // visible
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name.trim());
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.join(LABEL_SEPARATOR);
  };

  const options = categories
    .map((category) => ({
      id: category.id,
      // solo cuenta como padre si también es una opción
      parentId:
        category.parentId && byId.has(category.parentId)
          ? category.parentId
          : null,
      label: path(category),
    }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, 'es') || a.id.localeCompare(b.id),
    );

  const counts = new Map<string, number>();
  for (const option of options) {
    const seen = (counts.get(option.label) ?? 0) + 1;
    counts.set(option.label, seen);
    if (seen > 1) {
      option.label = `${option.label} (${seen})`;
    }
  }
  return options;
}

/**
 * Regla para un choice (ítem o compra completa):
 *  1. la opción más probable si su confianza llega a CHOICE_CONFIDENCE_THRESHOLD;
 *  2. si no, el padre cuya rama (él y sus hijas directas) concentre al menos
 *     PARENT_MASS_THRESHOLD de la probabilidad;
 *  3. si no, null.
 */
export function decideCategory(
  answer: ChoiceAnswer | undefined,
  byLabel: Map<string, CategoryOption>,
): CategoryDecision {
  const none: CategoryDecision = {
    categoryId: null,
    via: null,
    label: null,
    confidence: answer?.confidence ?? 0,
  };
  if (!answer) {
    return none;
  }

  const top = byLabel.get(answer.choice);
  if (top && answer.confidence >= CHOICE_CONFIDENCE_THRESHOLD) {
    return {
      categoryId: top.id,
      via: 'choice',
      label: top.label,
      confidence: answer.confidence,
    };
  }

  const mass = new Map<string, number>();
  for (const [label, probability] of Object.entries(answer.probabilities)) {
    const option = byLabel.get(label);
    if (!option) {
      continue;
    }
    // la probabilidad del propio padre también es de su rama
    const branch = option.parentId ?? option.id;
    mass.set(branch, (mass.get(branch) ?? 0) + probability);
  }
  const options = [...byLabel.values()];
  for (const [branchId, total] of mass) {
    const parent = options.find((option) => option.id === branchId);
    // una rama sin hijas es la misma categoría: ya se evaluó arriba
    const hasChildren = options.some((option) => option.parentId === branchId);
    if (parent && hasChildren && total >= PARENT_MASS_THRESHOLD) {
      return {
        categoryId: parent.id,
        via: 'parent',
        label: parent.label,
        confidence: answer.confidence,
      };
    }
  }
  return none;
}

/**
 * La categoría final del gasto.
 *  - Con categoría por defecto: se conserva salvo que Jev diga con claridad
 *    que la compra NO pertenece a ella (noul < DEFAULT_REJECT_NOUL_THRESHOLD)
 *    Y el choice de la compra completa se haya aceptado con otra categoría.
 *    En la franja dudosa gana la del usuario.
 *  - Sin categoría por defecto: el choice de la compra completa, o null.
 */
export function resolveExpenseCategory(
  defaultCategoryId: string | null,
  invoiceCategoryId: string | null,
  defaultNoul: number | null,
): string | null {
  if (!defaultCategoryId) {
    return invoiceCategoryId;
  }
  if (
    defaultNoul != null &&
    defaultNoul < DEFAULT_REJECT_NOUL_THRESHOLD &&
    invoiceCategoryId &&
    invoiceCategoryId !== defaultCategoryId
  ) {
    return invoiceCategoryId;
  }
  return defaultCategoryId;
}

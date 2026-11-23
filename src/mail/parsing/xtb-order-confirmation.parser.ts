// Confirmación de órdenes ejecutadas de XTB, reducida a lo que necesita el libro
// de inversiones. El nombre y la cuenta del titular se ignoran a propósito: ni
// se extraen ni aparecen en los mensajes de error.
//
// Es todo o nada: si una sección no trae las filas que anuncia, o una fila no
// valida, se rechaza el documento entero. Un documento a medias dejaría la
// cartera descuadrada sin que nadie lo note.

export type XtbOrderSide = 'BUY' | 'SELL';

export interface XtbOrder {
  side: XtbOrderSide;
  orderId: string;
  ticker: string;
  instrumentName: string;
  executionSystem: string;
  volume: number;
  // YYYY-MM-DD
  occurredOn: string;
  // HH:mm:ss tal como viene: el PDF no dice en qué zona horaria
  time: string;
  orderType: string;
  price: number;
  // lo que dice el PDF manda sobre volumen x precio, que puede variar en los
  // últimos decimales
  total: number;
  assetType: string;
  quoteCurrency: string;
  fxRate: number;
  fxCommission: number;
  commission: number;
}

export class XtbOrderConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XtbOrderConfirmationError';
  }
}

// Holgura entre el total y volumen x precio: el PDF redondea el volumen a 4
// decimales y eso se nota más cuanto más caro es el activo.
const TOTAL_TOLERANCE_ABSOLUTE = 0.01;
const TOTAL_TOLERANCE_RELATIVE = 0.001;
// holgura entre el coste total y la suma de las comisiones
const COST_TOLERANCE = 0.01;

const SECTION = /^[OÓ]rdenes de (compra|venta)\b.*\((\d+)\)$/i;
const ROW_START = /^\d+ \d{7,} [A-Z0-9][A-Z0-9._-]* /;

const NUM = String.raw`-?\d+(?:[.,]\d+)*`;
const ROW = new RegExp(
  '^' +
    String.raw`\d+ (?<orderId>\d{7,}) (?<ticker>[A-Z0-9][A-Z0-9._-]*) ` +
    // el nombre puede traer cualquier cosa; lo acota el sistema de ejecución,
    // que es la única palabra en mayúsculas seguida de volumen y fecha
    String.raw`(?<name>.+) (?<system>[A-Z][A-Z0-9]*) (?<volume>${NUM}) ` +
    String.raw`(?<date>\d{1,2}[/.]\d{1,2}[/.]\d{4}) (?<time>\d{1,2}:\d{2}(?::\d{2})?) ` +
    String.raw`(?<orderType>.+?) (?<price>${NUM}) (?<total>${NUM}) ` +
    String.raw`(?<assetType>.+?) (?<currency>[A-Z]{3}) (?<fxRate>${NUM}) ` +
    String.raw`(?<fxCommission>${NUM}) (?<commission>${NUM}) (?<totalCost>${NUM})` +
    '$',
);

interface Section {
  side: XtbOrderSide;
  expected: number;
  found: number;
}

/**
 * Devuelve las órdenes en el orden del documento, o una lista vacía si el texto
 * no es una confirmación de órdenes (XTB manda otros PDF desde la misma
 * dirección). Lanza XtbOrderConfirmationError si lo es pero no se puede confiar
 * en él.
 */
export function parseXtbOrderConfirmation(text: string): XtbOrder[] {
  const lines = text
    .normalize('NFC')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim());

  const orders: XtbOrder[] = [];
  let section: Section | null = null;
  let sectionsSeen = 0;
  // fila en curso: el nombre se parte en varias líneas
  let pending: string | null = null;

  const assertRowClosed = () => {
    if (pending !== null) {
      throw new XtbOrderConfirmationError(
        `No se pudo leer la fila de la orden ${orderIdOf(pending)}`,
      );
    }
  };
  const assertSectionComplete = () => {
    if (section && section.found !== section.expected) {
      throw new XtbOrderConfirmationError(
        `Una sección de ${section.side === 'BUY' ? 'compras' : 'ventas'} anuncia ${section.expected} órdenes y se leyeron ${section.found}`,
      );
    }
  };

  for (const line of lines) {
    const heading = SECTION.exec(line);
    if (heading) {
      assertRowClosed();
      assertSectionComplete();
      sectionsSeen += 1;
      section = {
        side: heading[1].toLowerCase() === 'compra' ? 'BUY' : 'SELL',
        expected: Number(heading[2]),
        found: 0,
      };
      continue;
    }

    if (ROW_START.test(line)) {
      assertRowClosed();
      pending = line;
    } else if (pending !== null) {
      pending = `${pending} ${line}`.trim();
    } else {
      // cabeceras de columna, pie de página: nada que leer
      continue;
    }

    const row = ROW.exec(pending);
    if (row?.groups) {
      if (!section) {
        throw new XtbOrderConfirmationError(
          `La orden ${row.groups.orderId} aparece fuera de una sección de compras o ventas`,
        );
      }
      orders.push(toOrder(section.side, row.groups));
      section.found += 1;
      pending = null;
    }
  }
  assertRowClosed();
  assertSectionComplete();

  if (sectionsSeen === 0 && /confirmaci[oó]n de [oó]rdenes/i.test(text)) {
    throw new XtbOrderConfirmationError(
      'La confirmación de órdenes no trae ninguna sección reconocible',
    );
  }
  return orders;
}

function toOrder(side: XtbOrderSide, groups: Record<string, string>): XtbOrder {
  const { orderId, ticker } = groups;
  const fail = (reason: string): never => {
    throw new XtbOrderConfirmationError(
      `La orden ${orderId} (${ticker}) no es válida: ${reason}`,
    );
  };

  const volume = parseXtbNumber(groups.volume);
  const price = parseXtbNumber(groups.price);
  const total = parseXtbNumber(groups.total);
  const fxRate = parseXtbNumber(groups.fxRate);
  // las comisiones son magnitudes, igual que en el libro; el signo no aporta
  const fxCommission = Math.abs(parseXtbNumber(groups.fxCommission));
  const commission = Math.abs(parseXtbNumber(groups.commission));
  const totalCost = Math.abs(parseXtbNumber(groups.totalCost));
  const occurredOn = parseXtbDate(groups.date);

  if (!occurredOn) {
    return fail('la fecha es inválida');
  }
  if (!(volume > 0) || !(price > 0) || !(total > 0) || !(fxRate > 0)) {
    return fail(
      'el volumen, el precio, el total y la tasa deben ser positivos',
    );
  }
  const tolerance = Math.max(
    TOTAL_TOLERANCE_ABSOLUTE,
    total * TOTAL_TOLERANCE_RELATIVE,
  );
  if (Math.abs(total - volume * price) > tolerance) {
    return fail(`el total ${total} no cuadra con ${volume} x ${price}`);
  }
  if (Math.abs(totalCost - (fxCommission + commission)) > COST_TOLERANCE) {
    return fail(
      `el coste total ${totalCost} no cuadra con las comisiones ${fxCommission} + ${commission}`,
    );
  }

  const [hours, minutes, seconds = '00'] = groups.time.split(':');
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
    return fail('la hora es inválida');
  }
  return {
    side,
    orderId,
    ticker,
    instrumentName: groups.name,
    executionSystem: groups.system,
    volume,
    occurredOn,
    time: `${hours.padStart(2, '0')}:${minutes}:${seconds}`,
    orderType: groups.orderType,
    price,
    total,
    assetType: groups.assetType,
    quoteCurrency: groups.currency,
    fxRate,
    fxCommission,
    commission,
  };
}

// La fila en curso puede no llegar a validar; de ella solo sale el id de la orden
function orderIdOf(row: string): string {
  return row.split(' ')[1] ?? 'desconocida';
}

// "809,27000", "110.05000", "1.776,76": con los dos separadores el decimal es el
// último; con uno solo, ese es el decimal. Repetido, son miles.
export function parseXtbNumber(raw: string): number {
  const separators = raw.match(/[.,]/g) ?? [];
  const decimal =
    new Set(separators).size === 2 || separators.length === 1
      ? raw.lastIndexOf(separators[separators.length - 1])
      : -1;
  const digits = (text: string) => text.replace(/[.,]/g, '');
  return decimal < 0
    ? Number(digits(raw))
    : Number(
        `${digits(raw.slice(0, decimal))}.${digits(raw.slice(decimal + 1))}`,
      );
}

// "27/5/2026" o "10.06.2025", siempre día antes que mes. Null si no existe.
function parseXtbDate(raw: string): string | null {
  const [day, month, year] = raw.split(/[/.]/).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().substring(0, 10);
}

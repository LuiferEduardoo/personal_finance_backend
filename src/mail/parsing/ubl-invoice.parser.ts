import { XMLParser } from 'fast-xml-parser';
import { roundAmount } from '../../common/discount';

// Factura electrónica DIAN (UBL 2.1) reducida a lo que necesita un gasto.
//
// Se lee el XML y NO el PDF: el XML es el documento legal, trae cada línea
// con cantidad, base e impuestos, y se interpreta de forma determinista, sin
// pasar por un modelo de lenguaje.

export interface ParsedInvoiceLine {
  description: string;
  quantity: number;
  // precio unitario CON impuestos: es lo que el usuario pagó por unidad
  unitPrice: number;
  discount: number;
  barcode: string | null;
}

export interface ParsedInvoice {
  cufe: string;
  number: string;
  issueDate: string;
  currency: string;
  issuerName: string;
  issuerNit: string | null;
  // lo que se pagó: LegalMonetaryTotal/PayableAmount
  total: number;
  // vacío si las líneas no cuadran con el total (ver `reconcile`)
  items: ParsedInvoiceLine[];
}

// Holgura para absorber redondeos al repartir impuestos por línea. Más allá
// de esto hay descuentos o cargos globales que las líneas no explican.
const RECONCILE_TOLERANCE = 1;

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // todo como texto: los códigos de barras llevan ceros y espacios a la
  // izquierda y los importes se convierten a mano
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) =>
    ['InvoiceLine', 'TaxTotal', 'AllowanceCharge'].includes(name),
});

/**
 * Interpreta una factura DIAN. Acepta el contenedor `AttachedDocument` (lo
 * que llega por correo, con la factura embebida en un CDATA) o la `Invoice`
 * directa. Devuelve null si el XML no es una factura de venta: notas crédito,
 * notas débito, respuestas de la DIAN, etc.
 */
export function parseDianInvoice(xml: string): ParsedInvoice | null {
  let root: XmlNode;
  try {
    root = parser.parse(stripBom(xml)) as XmlNode;
  } catch {
    return null;
  }

  let invoice = asNode(root.Invoice);
  if (!invoice && root.AttachedDocument) {
    // la factura va en la PRIMERA Attachment del contenedor; la respuesta de
    // validación de la DIAN va aparte, en ParentDocumentLineReference
    const embedded = text(
      path(root.AttachedDocument, [
        'Attachment',
        'ExternalReference',
        'Description',
      ]),
    );
    if (!embedded) {
      return null;
    }
    try {
      invoice = asNode((parser.parse(stripBom(embedded)) as XmlNode).Invoice);
    } catch {
      return null;
    }
  }
  if (!invoice) {
    return null;
  }

  const cufe = text(invoice.UUID);
  const number = text(invoice.ID);
  const issueDate = text(invoice.IssueDate);
  const total =
    amount(path(invoice, ['LegalMonetaryTotal', 'PayableAmount'])) ??
    amount(path(invoice, ['LegalMonetaryTotal', 'TaxInclusiveAmount']));
  if (!cufe || !number || !issueDate || total == null) {
    return null;
  }

  const supplier = path(invoice, ['AccountingSupplierParty', 'Party']);
  const issuerName =
    text(path(supplier, ['PartyTaxScheme', 'RegistrationName'])) ??
    text(path(supplier, ['PartyLegalEntity', 'RegistrationName'])) ??
    text(path(supplier, ['PartyName', 'Name'])) ??
    'Desconocido';
  const issuerNit =
    text(path(supplier, ['PartyTaxScheme', 'CompanyID'])) ??
    text(path(supplier, ['PartyLegalEntity', 'CompanyID']));

  const lines = toArray(invoice.InvoiceLine)
    .map(parseLine)
    .filter((line): line is ParsedInvoiceLine => line !== null);

  return {
    cufe,
    number,
    issueDate,
    currency: text(invoice.DocumentCurrencyCode) ?? 'COP',
    issuerName,
    issuerNit,
    total,
    items: reconcile(lines, total),
  };
}

// Una línea UBL trae LineExtensionAmount = precio * cantidad - descuentos +
// cargos, SIN impuestos. El gasto necesita lo pagado, así que se suman los
// impuestos de la línea (IVA, impoconsumo). Las retenciones van en
// WithholdingTaxTotal y no se suman: no salen del bolsillo del comprador.
function parseLine(line: unknown): ParsedInvoiceLine | null {
  const quantity = amount(path(line, ['InvoicedQuantity']));
  const base = amount(path(line, ['LineExtensionAmount']));
  if (!quantity || quantity <= 0 || base == null) {
    return null;
  }

  const tax = toArray(path(line, ['TaxTotal'])).reduce<number>(
    (sum, total) => sum + (amount(path(total, ['TaxAmount'])) ?? 0),
    0,
  );
  const discount = roundAmount(
    toArray(path(line, ['AllowanceCharge']))
      .filter((ac) => text(path(ac, ['ChargeIndicator'])) === 'false')
      .reduce<number>(
        (sum, ac) => sum + (amount(path(ac, ['Amount'])) ?? 0),
        0,
      ),
  );

  // el neto de la línea ya descuenta; se reconstruye el bruto para que
  // unitPrice * quantity - discount vuelva a dar lo pagado
  const net = base + tax;
  return {
    description:
      text(path(line, ['Item', 'Description'])) ?? 'Artículo sin descripción',
    quantity,
    unitPrice: roundAmount((net + discount) / quantity),
    discount,
    barcode: text(path(line, ['Item', 'StandardItemIdentification', 'ID'])),
  };
}

/**
 * Hace que la suma de las líneas sea EXACTAMENTE el total pagado, porque el
 * importe del gasto se calcula desde los ítems y es lo que se descuenta de la
 * cuenta. Diferencias de redondeo se absorben en una línea; si no se puede, o
 * la diferencia es mayor (descuentos o cargos globales), se devuelve una
 * lista vacía y el gasto se registra solo con el total.
 */
export function reconcile(
  lines: ParsedInvoiceLine[],
  total: number,
): ParsedInvoiceLine[] {
  if (lines.length === 0) {
    return [];
  }
  const sum = roundAmount(lines.reduce((acc, line) => acc + subtotal(line), 0));
  const diff = roundAmount(sum - total);
  if (diff === 0) {
    return lines;
  }
  if (Math.abs(diff) > RECONCILE_TOLERANCE) {
    return [];
  }

  const adjusted = lines.map((line) => ({ ...line }));
  if (diff > 0) {
    // sobra: más descuento en la línea más grande
    const target = adjusted.reduce((a, b) =>
      subtotal(b) > subtotal(a) ? b : a,
    );
    if (subtotal(target) < diff) {
      return [];
    }
    target.discount = roundAmount(target.discount + diff);
    return adjusted;
  }
  // falta: solo se puede subir el precio exacto de una línea de cantidad 1
  const target = adjusted.find((line) => line.quantity === 1);
  if (!target) {
    return [];
  }
  target.unitPrice = roundAmount(target.unitPrice - diff);
  return adjusted;
}

function subtotal(line: ParsedInvoiceLine): number {
  return roundAmount(line.unitPrice * line.quantity) - line.discount;
}

// --- utilidades de navegación del árbol de fast-xml-parser ---

function path(node: unknown, keys: string[]): unknown {
  let current: unknown = node;
  for (const key of keys) {
    // si en el camino hay un array (p. ej. varias Attachment), se toma el primero
    if (Array.isArray(current)) {
      current = current[0];
    }
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as XmlNode)[key];
  }
  return current;
}

// un elemento con atributos llega como { '#text': ..., '@schemeID': ... }
function text(value: unknown): string | null {
  const node: unknown = Array.isArray(value) ? value[0] : value;
  const raw =
    node && typeof node === 'object' ? (node as XmlNode)['#text'] : node;
  if (raw == null) {
    return null;
  }
  const trimmed = String(raw as string | number).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function amount(node: unknown): number | null {
  const value = text(node);
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNode(value: unknown): XmlNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlNode)
    : null;
}

function toArray(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stripBom(value: string): string {
  return value.replace(/^﻿/, '').trim();
}

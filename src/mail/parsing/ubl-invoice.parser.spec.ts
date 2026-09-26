import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDianInvoice, reconcile } from './ubl-invoice.parser';

const D1_XML = readFileSync(
  join(__dirname, '__fixtures__', 'd1-attached-document.xml'),
  'utf8',
);

const CUFE =
  '68028e3a7a76999b4258b66916fd2f3bf197c0f8bb7ec7a140796d45bf45af8bc8482c4b193c074db5719340d90e91df';

// saca la Invoice embebida en el CDATA del contenedor
function innerInvoice(): string {
  const start = D1_XML.indexOf('<Invoice ');
  const end = D1_XML.indexOf('</Invoice>') + '</Invoice>'.length;
  return D1_XML.slice(start, end);
}

function invoiceWithLines(lines: string, payable: string): string {
  return `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:ID>F1</cbc:ID><cbc:UUID>abc</cbc:UUID><cbc:IssueDate>2026-01-02</cbc:IssueDate>
    <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">${payable}</cbc:PayableAmount></cac:LegalMonetaryTotal>
    ${lines}
  </Invoice>`;
}

describe('parseDianInvoice: contenedor AttachedDocument del D1', () => {
  const invoice = parseDianInvoice(D1_XML)!;

  it('lee la cabecera de la factura embebida', () => {
    expect(invoice).toMatchObject({
      cufe: CUFE,
      number: 'M2J675929',
      issueDate: '2026-09-22',
      currency: 'COP',
      issuerName: 'D1 S A S',
      issuerNit: '900276962',
      total: 7980,
    });
  });

  it('saca las líneas con el precio unitario CON impuestos', () => {
    expect(invoice.items).toEqual([
      {
        description: 'MINI CROISSANT HORNE',
        quantity: 1,
        unitPrice: 3990,
        discount: 0,
        barcode: '7700304928064',
      },
      {
        // base 3352.94 + IVA 637.06
        description: 'PONQUE TRADICIONAL H',
        quantity: 1,
        unitPrice: 3990,
        discount: 0,
        barcode: '7700304203765',
      },
    ]);
  });

  it('la suma de las líneas es exactamente lo pagado', () => {
    const sum = invoice.items.reduce(
      (acc, i) => acc + i.unitPrice * i.quantity - i.discount,
      0,
    );
    expect(sum).toBe(invoice.total);
  });
});

describe('parseDianInvoice: otras formas', () => {
  it('acepta la Invoice sin contenedor', () => {
    const invoice = parseDianInvoice(innerInvoice());
    expect(invoice?.cufe).toBe(CUFE);
    expect(invoice?.items).toHaveLength(2);
  });

  it('tolera BOM al principio', () => {
    expect(parseDianInvoice('﻿' + innerInvoice())?.number).toBe('M2J675929');
  });

  it('una nota crédito no es una factura', () => {
    const credit = innerInvoice()
      .replace('<Invoice ', '<CreditNote ')
      .replace('</Invoice>', '</CreditNote>');
    expect(parseDianInvoice(credit)).toBeNull();
  });

  it('XML roto o ajeno devuelve null', () => {
    expect(parseDianInvoice('<Invoice><cbc:ID>')).toBeNull();
    expect(parseDianInvoice('<Otro/>')).toBeNull();
  });

  it('descuento de línea: el bruto se reconstruye y el neto cuadra', () => {
    const xml = invoiceWithLines(
      `<cac:InvoiceLine>
        <cbc:InvoicedQuantity>2</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount>9000.00</cbc:LineExtensionAmount>
        <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount>1000.00</cbc:Amount></cac:AllowanceCharge>
        <cac:TaxTotal><cbc:TaxAmount>1710.00</cbc:TaxAmount></cac:TaxTotal>
        <cac:Item><cbc:Description>ARROZ</cbc:Description></cac:Item>
      </cac:InvoiceLine>`,
      '10710.00',
    );
    expect(parseDianInvoice(xml)?.items).toEqual([
      {
        description: 'ARROZ',
        quantity: 2,
        unitPrice: 5855,
        discount: 1000,
        barcode: null,
      },
    ]);
  });

  it('descuento global que las líneas no explican: solo total', () => {
    const xml = invoiceWithLines(
      `<cac:InvoiceLine>
        <cbc:InvoicedQuantity>1</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount>10000.00</cbc:LineExtensionAmount>
        <cac:Item><cbc:Description>X</cbc:Description></cac:Item>
      </cac:InvoiceLine>`,
      '8000.00',
    );
    const invoice = parseDianInvoice(xml);
    expect(invoice?.total).toBe(8000);
    expect(invoice?.items).toEqual([]);
  });
});

describe('reconcile', () => {
  const line = (unitPrice: number, quantity = 1) => ({
    description: 'x',
    quantity,
    unitPrice,
    discount: 0,
    barcode: null,
  });

  it('si sobran centavos los descuenta de la línea más grande', () => {
    const lines = reconcile([line(100.01), line(50)], 150);
    expect(lines[0].discount).toBe(0.01);
    expect(lines[1].discount).toBe(0);
  });

  it('si faltan centavos sube el precio de una línea de cantidad 1', () => {
    const lines = reconcile([line(33.33, 0.5), line(10)], 26.68);
    expect(lines[1].unitPrice).toBe(10.01);
  });

  it('si faltan y no hay línea de cantidad 1, se rinde', () => {
    expect(reconcile([line(10, 0.5)], 5.01)).toEqual([]);
  });
});

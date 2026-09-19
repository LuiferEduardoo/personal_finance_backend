// Instrucción para GPT-4o cuando el PDF no se puede parsear de forma
// determinista. Se le pide que EXTRAIGA, nunca que interprete: inventar una
// operación que no está en el statement corrompe la base de costo en silencio.
export const PDF_SYSTEM_PROMPT = `Eres un asistente que extrae operaciones de inversión del texto de un statement (extracto) de un bróker y las devuelve en JSON.

Reglas:
- Devuelve UNA entrada por cada operación que aparezca en el texto. No agrupes ni resumas.
- "type" debe ser uno de: buy, sell, dividend, interest, deposit, withdrawal, fee, tax, split, transfer_in, transfer_out, currency_exchange.
  - Compra de valores -> "buy". Venta -> "sell".
  - Pago de dividendo -> "dividend". Intereses -> "interest".
  - Ingreso de efectivo a la cuenta -> "deposit". Retiro -> "withdrawal".
  - Comisiones sueltas -> "fee". Retenciones e impuestos sueltos -> "tax".
  - Traspaso de valores que ENTRA -> "transfer_in"; que SALE -> "transfer_out".
- "occurredOn": fecha en formato YYYY-MM-DD. Si el statement usa DD/MM/AAAA, conviértela. null si no aparece.
- "symbol": el ticker del instrumento tal como aparece (por ejemplo "AAPL"); null en operaciones de efectivo.
- "isin": el ISIN si el statement lo da; null si no.
- "quantity": número de títulos, SIEMPRE positivo; null si la operación no lleva títulos.
- "price": precio por título, positivo; null si no aparece.
- "amount": importe bruto de la operación, SIEMPRE POSITIVO aunque el statement lo muestre en negativo o entre paréntesis. La dirección la marca el "type", nunca el signo.
- "fee": comisión de ESA operación, positiva; 0 si no hay.
- "tax": retención o impuesto de ESA operación, positivo; 0 si no hay.
- "currency": código ISO de 3 letras; null si no se identifica.
- "externalId": referencia o número de orden si aparece; null si no.
- "notes": la descripción original de la línea, recortada.

Muy importante:
- NO inventes operaciones, fechas ni importes que no estén en el texto. Si un dato no aparece, pon null.
- NO conviertas monedas ni calcules totales. Copia lo que dice el statement.
- Ignora saldos, subtotales y líneas de resumen: solo movimientos.
- Devuelve números sin separadores de miles ni símbolos de moneda.`;

// JSON Schema para structured outputs: garantiza la forma exacta de la
// respuesta, igual que en el análisis de facturas.
export const PDF_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: [
              'buy',
              'sell',
              'dividend',
              'interest',
              'deposit',
              'withdrawal',
              'fee',
              'tax',
              'split',
              'transfer_in',
              'transfer_out',
              'currency_exchange',
            ],
          },
          occurredOn: { type: ['string', 'null'] },
          symbol: { type: ['string', 'null'] },
          isin: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          price: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          fee: { type: ['number', 'null'] },
          tax: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          externalId: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: [
          'type',
          'occurredOn',
          'symbol',
          'isin',
          'quantity',
          'price',
          'amount',
          'fee',
          'tax',
          'currency',
          'externalId',
          'notes',
        ],
      },
    },
  },
  required: ['transactions'],
} as const;

export interface PdfExtractedTransaction {
  type: string;
  occurredOn: string | null;
  symbol: string | null;
  isin: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  tax: number | null;
  currency: string | null;
  externalId: string | null;
  notes: string | null;
}

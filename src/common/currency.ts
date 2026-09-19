import { BadRequestException } from '@nestjs/common';

// Códigos ISO 4217 que la app acepta. No es la lista completa del estándar:
// están las monedas con las que opera un inversor personal más las que ya
// usaba el resto del backend. Añadir una moneda nueva es agregarla aquí.
const ISO_4217 = new Set([
  'AED',
  'ARS',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PEN',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'USD',
  'UYU',
  'VND',
  'ZAR',
]);

// Criptomonedas y stablecoins tratadas como "moneda" en un exchange.
// Van aparte porque no son ISO 4217 pero sí aparecen como divisa de
// liquidación en Binance y similares.
const CRYPTO_CURRENCIES = new Set([
  'BTC',
  'ETH',
  'USDT',
  'USDC',
  'BNB',
  'BUSD',
  'DAI',
  'SOL',
  'XRP',
  'ADA',
]);

// normaliza a mayúsculas y valida. sin esto 'usd' y 'USD' fragmentan
// silenciosamente el caché de tasas de cambio.
export function assertCurrency(code: string): string {
  const normalized = code?.trim().toUpperCase();
  if (!normalized || normalized.length !== 3) {
    throw new BadRequestException(
      `Moneda "${code}" no válida (usa un código ISO 4217 de 3 letras)`,
    );
  }
  if (!ISO_4217.has(normalized) && !CRYPTO_CURRENCIES.has(normalized)) {
    throw new BadRequestException(
      `Moneda "${normalized}" no soportada (usa un código ISO 4217)`,
    );
  }
  return normalized;
}

export function isCrypto(code: string): boolean {
  return CRYPTO_CURRENCIES.has(code?.trim().toUpperCase());
}

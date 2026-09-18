import { BadRequestException } from '@nestjs/common';

// Entrada de descuento de una línea: importe absoluto o porcentaje, nunca
// ambos. En la base se guarda siempre el importe absoluto, para que el
// subtotal sea una columna generada y no dependa de recalcular el porcentaje.
export interface DiscountInput {
  discount?: number | null;
  discountPercent?: number | null;
}

// redondeo a 2 decimales, la escala con la que se guardan los importes
export function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resuelve el descuento de una línea a importe absoluto y valida que no
 * supere el bruto (unitPrice * quantity). Devuelve 0 si no hay descuento.
 */
export function resolveDiscount(gross: number, input: DiscountInput): number {
  const { discount, discountPercent } = input;

  if (discount != null && discountPercent != null) {
    throw new BadRequestException(
      'Usa discount (importe) o discountPercent (porcentaje), no ambos',
    );
  }

  if (discountPercent != null) {
    if (discountPercent < 0 || discountPercent > 100) {
      throw new BadRequestException('discountPercent debe estar entre 0 y 100');
    }
    return roundAmount((gross * discountPercent) / 100);
  }

  if (discount == null) {
    return 0;
  }
  if (discount < 0) {
    throw new BadRequestException('El descuento no puede ser negativo');
  }

  const rounded = roundAmount(discount);
  if (rounded > roundAmount(gross)) {
    throw new BadRequestException(
      'El descuento no puede superar el importe de la línea',
    );
  }
  return rounded;
}

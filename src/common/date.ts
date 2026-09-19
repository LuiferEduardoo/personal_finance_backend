// Normaliza a 'YYYY-MM-DD' un valor de fecha venido de una consulta cruda.
//
// POR QUÉ EXISTE: el driver de Postgres (pg) parsea las columnas `date` a
// objetos Date de JavaScript, NO a strings. Eso hace que el patrón ingenuo
// String(valor).substring(0, 10) produzca "Mon Sep 01" en vez de "2025-09-01",
// y a partir de ahí todo falla en silencio: comparaciones de fecha que nunca
// casan, rangos que el proveedor rechaza y días marcados como estimados sin
// motivo.
//
// Se formatea con las partes LOCALES a propósito: pg construye el Date en la
// medianoche local del servidor, así que toISOString() devolvería el día
// anterior en cualquier zona al este de UTC.
export function toDateString(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.substring(0, 10);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Igual, pero devolviendo un string vacío en vez de null cuando no hay fecha.
export function toDateStringOr(
  value: Date | string | null | undefined,
  fallback: string,
): string {
  return toDateString(value) ?? fallback;
}

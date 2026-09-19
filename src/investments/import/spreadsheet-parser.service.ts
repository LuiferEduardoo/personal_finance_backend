import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
// import de namespace, NO default: exceljs es CommonJS y el repo tiene
// allowSyntheticDefaultImports sin esModuleInterop, así que un import por
// defecto compila pero llega undefined en tiempo de ejecución.
import * as ExcelJS from 'exceljs';
import { toDateString } from '../../common/date';
import { ParserProfile } from './profiles/profile.types';

export interface SheetTable {
  headers: string[];
  rows: Record<string, string>[];
  /** nombre de la hoja en un XLSX, null en CSV */
  sheetName: string | null;
}

// Lee CSV y XLSX a una tabla de strings. Deliberadamente NO interpreta nada:
// la interpretación (tipos, fechas, decimales) es del perfil, porque cada
// bróker escribe las mismas cosas de forma distinta.
@Injectable()
export class SpreadsheetParserService {
  private readonly logger = new Logger(SpreadsheetParserService.name);

  async parse(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<SheetTable> {
    const isExcel =
      /\.xlsx?$/i.test(fileName) ||
      mimeType.includes('spreadsheetml') ||
      mimeType.includes('ms-excel');
    return isExcel ? this.parseExcel(buffer) : this.parseCsv(buffer);
  }

  private parseCsv(buffer: Buffer): SheetTable {
    const text = buffer.toString('utf8');
    // los brókers europeos exportan con punto y coma; detectarlo evita que
    // todo el archivo caiga en una sola columna
    const delimiter = this.detectDelimiter(text);
    let records: Record<string, string>[];
    try {
      records = parse(text, {
        columns: true,
        bom: true,
        delimiter,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as Record<string, string>[];
    } catch (error) {
      throw new BadRequestException(
        `No se pudo leer el CSV: ${(error as Error).message}`,
      );
    }
    if (records.length === 0) {
      throw new BadRequestException('El archivo no tiene filas de datos');
    }
    return {
      headers: Object.keys(records[0]),
      rows: records,
      sheetName: null,
    };
  }

  private detectDelimiter(text: string): string {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
    const counts: Record<string, number> = {
      ',': (firstLine.match(/,/g) ?? []).length,
      ';': (firstLine.match(/;/g) ?? []).length,
      '\t': (firstLine.match(/\t/g) ?? []).length,
    };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private async parseExcel(buffer: Buffer): Promise<SheetTable> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (error) {
      throw new BadRequestException(
        `No se pudo leer el XLSX: ${(error as Error).message}`,
      );
    }

    // se toma la hoja con más filas: los statements suelen traer varias y la
    // primera a menudo es una portada
    const sheet = workbook.worksheets
      .slice()
      .sort((a, b) => b.rowCount - a.rowCount)[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new BadRequestException('El archivo no tiene filas de datos');
    }

    const headerRow = this.findHeaderRow(sheet);
    const headers: string[] = [];
    sheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = String(cell.value ?? '').trim();
    });

    const rows: Record<string, string>[] = [];
    for (let i = headerRow + 1; i <= sheet.rowCount; i += 1) {
      const row = sheet.getRow(i);
      const record: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        if (!header) {
          return;
        }
        const value = row.getCell(index + 1).value;
        const text = this.cellToString(value);
        record[header] = text;
        if (text) {
          hasValue = true;
        }
      });
      if (hasValue) {
        rows.push(record);
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException('El archivo no tiene filas de datos');
    }
    return {
      headers: headers.filter(Boolean),
      rows,
      sheetName: sheet.name,
    };
  }

  // Los statements suelen llevar un par de filas de título antes de la
  // cabecera real; se busca la primera fila con varias celdas de texto.
  private findHeaderRow(sheet: ExcelJS.Worksheet): number {
    for (let i = 1; i <= Math.min(sheet.rowCount, 15); i += 1) {
      let filled = 0;
      sheet.getRow(i).eachCell({ includeEmpty: false }, (cell) => {
        if (String(cell.value ?? '').trim()) {
          filled += 1;
        }
      });
      if (filled >= 3) {
        return i;
      }
    }
    return 1;
  }

  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return toDateString(value) ?? '';
    }
    if (typeof value === 'object') {
      const rich = value as {
        text?: string;
        result?: unknown;
        formula?: string;
      };
      if (typeof rich.text === 'string') {
        return rich.text.trim();
      }
      if (rich.result !== undefined && rich.result !== null) {
        return String(rich.result).trim();
      }
      return '';
    }
    return String(value).trim();
  }
}

// --- normalización de valores, dependiente del perfil ---

// Convierte un número escrito a la europea o a la americana.
// "1.234,56" y "1,234.56" son el mismo número; adivinarlo mal desplaza la coma
// y multiplica el importe por mil.
export function parseNumber(
  raw: string | undefined,
  profile: ParserProfile,
): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  let text = String(raw).trim();
  if (!text) {
    return null;
  }
  // algunos brókers escriben los negativos entre paréntesis
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) {
    text = `-${parenthesised[1]}`;
  }
  text = text.replace(/[^\d,.\-+]/g, '');
  if (!text || text === '-' || text === '+') {
    return null;
  }

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // el separador decimal es el que aparece MÁS A LA DERECHA
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    // "1,234" con tres decimales es un separador de miles, no decimal
    text =
      profile.decimalSeparator === ',' || decimals !== 3
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// Convierte la fecha al formato YYYY-MM-DD respetando el orden del perfil.
// 01/09/2026 es el 1 de septiembre en Europa y el 9 de enero en EE. UU.
export function parseDate(
  raw: string | undefined,
  profile: ParserProfile,
): string | null {
  if (!raw) {
    return null;
  }
  const text = String(raw).trim();
  if (!text) {
    return null;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  // formato compacto de IBKR: 20260901
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(text);
  if (parts) {
    const [, a, b, c] = parts;
    const year = c.length === 2 ? `20${c}` : c;
    const order = profile.dateOrder ?? 'DMY';
    const day = order === 'MDY' ? b : a;
    const month = order === 'MDY' ? a : b;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : toDateString(parsed);
}

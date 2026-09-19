import { ConfigService } from '@nestjs/config';
import { PdfStatementService } from './pdf-statement.service';

// NOTA sobre la cobertura de este archivo:
//
// extractText() NO se prueba aquí. pdf-parse v2 carga el worker de pdfjs como
// un módulo .mjs, y Jest en modo CommonJS no puede importarlo dinámicamente sin
// --experimental-vm-modules, que cambiaría cómo corre TODO el repo. Funciona
// perfectamente en el runtime de Nest, así que se verifica de extremo a extremo
// contra el servidor (subiendo un PDF real) en vez de retorcer la config de
// tests de todo el proyecto por un solo archivo.
//
// Lo que sí es puro —el troceado— se prueba aquí.

const service = new PdfStatementService(new ConfigService());

describe('PdfStatementService: troceado del texto', () => {
  it('no parte una línea por la mitad', () => {
    const lineas = Array.from(
      { length: 2000 },
      (_, i) => `linea ${i} con texto`,
    );
    const chunks = service.chunk(lineas.join('\n'));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const linea of chunk.split('\n').filter(Boolean)) {
        // si el troceo partiera una línea, esto fallaría
        expect(linea).toMatch(/^linea \d+ con texto$/);
      }
    }
  });

  it('un texto corto queda en un solo trozo', () => {
    expect(service.chunk('una sola linea')).toHaveLength(1);
  });

  it('no pierde líneas al trocear', () => {
    const lineas = Array.from({ length: 500 }, (_, i) => `op ${i}`);
    const chunks = service.chunk(lineas.join('\n'));
    const recuperadas = chunks
      .join('')
      .split('\n')
      .filter((l) => l.trim());
    expect(recuperadas).toHaveLength(lineas.length);
    expect(recuperadas[0]).toBe('op 0');
    expect(recuperadas[recuperadas.length - 1]).toBe('op 499');
  });

  it('acota el número de trozos para no disparar el gasto en el modelo', () => {
    const enorme = Array.from({ length: 100_000 }, () => 'x'.repeat(100)).join(
      '\n',
    );
    expect(service.chunk(enorme).length).toBeLessThanOrEqual(20);
  });

  it('un texto vacío no produce trozos', () => {
    expect(service.chunk('')).toHaveLength(0);
  });
});

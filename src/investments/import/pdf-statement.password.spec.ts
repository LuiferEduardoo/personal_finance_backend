import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordException, PDFParse } from 'pdf-parse';
import {
  PdfPasswordException,
  PdfStatementService,
} from './pdf-statement.service';

// El worker real de pdfjs no carga en Jest (ver pdf-statement.spec.ts): aquí se
// prueba la traducción de errores con el lector falseado.
jest.mock('pdf-parse', () => {
  class PasswordExceptionMock extends Error {}
  return { PasswordException: PasswordExceptionMock, PDFParse: jest.fn() };
});

const SECRET = 'contraseña-secreta';
const LONG_TEXT = 'Confirmación de órdenes ejecutadas '.repeat(3);

function parserThatFails(error: Error) {
  (PDFParse as unknown as jest.Mock).mockImplementation(() => ({
    getText: () => Promise.reject(error),
    destroy: () => Promise.resolve(),
  }));
}

describe('PdfStatementService.extractText con contraseña', () => {
  const service = new PdfStatementService(new ConfigService());
  const buffer = Buffer.from('pdf');

  it('pasa la contraseña al lector solo si la hay', async () => {
    (PDFParse as unknown as jest.Mock).mockImplementation(() => ({
      getText: () => Promise.resolve({ text: LONG_TEXT, pages: [{}] }),
      destroy: () => Promise.resolve(),
    }));

    await service.extractText(buffer, SECRET);
    expect(PDFParse).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: SECRET }),
    );

    await service.extractText(buffer);
    expect(
      (PDFParse as unknown as jest.Mock).mock.lastCall?.[0],
    ).not.toHaveProperty('password');
  });

  it('contraseña incorrecta: error propio y sin repetirla', async () => {
    parserThatFails(new PasswordException('Incorrect Password'));
    const failure = service.extractText(buffer, SECRET);
    await expect(failure).rejects.toBeInstanceOf(PdfPasswordException);
    await expect(failure).rejects.toThrow('es incorrecta');
    await expect(failure).rejects.not.toThrow(SECRET);
  });

  it('sin contraseña: error propio que lo dice', async () => {
    parserThatFails(new PasswordException('No password given'));
    const failure = service.extractText(buffer);
    await expect(failure).rejects.toBeInstanceOf(PdfPasswordException);
    await expect(failure).rejects.toThrow('no se indicó ninguna');
  });

  it('otro fallo no se confunde con la contraseña ni la repite', async () => {
    parserThatFails(new Error(`PDF inválido con ${SECRET}`));
    const failure = service.extractText(buffer, SECRET);
    await expect(failure).rejects.toBeInstanceOf(BadRequestException);
    await expect(failure).rejects.not.toBeInstanceOf(PdfPasswordException);
    await expect(failure).rejects.toThrow('No se pudo leer el PDF');
    await expect(failure).rejects.not.toThrow(SECRET);
  });
});

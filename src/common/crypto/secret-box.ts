import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Cifrado simétrico para credenciales de bróker.
//
// El repo solo tenía hash de una vía (createHash) para API keys y refresh
// tokens; eso sirve para verificar algo que el usuario reenvía, no para
// guardar un secreto que hay que poder RECUPERAR y volver a presentar al
// bróker. Esto es código nuevo a propósito.
//
// AES-256-GCM: cifra y autentica a la vez, así que un ciphertext manipulado
// falla al descifrar en vez de devolver basura.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM

export const CURRENT_KEY_VERSION = 1;
export const PREVIOUS_KEY_VERSION = 0;

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

@Injectable()
export class SecretBox {
  constructor(private readonly configService: ConfigService) {}

  get configured(): boolean {
    return Boolean(
      this.configService.get<string>('INVESTMENTS_ENCRYPTION_KEY'),
    );
  }

  // Cifra y devuelve las tres piezas por separado, para guardarlas en columnas
  // bytea distintas.
  //
  // El AAD ata el ciphertext a SU fila: un atacante con acceso de escritura a
  // la base no puede mover las credenciales de una conexión a otra, porque el
  // descifrado fallaría.
  //
  // El AAD lleva SOLO el connectionId, no la versión de clave. Llevarla hacía
  // imposible la rotación: una fila sellada con la clave vieja quedaba atada a
  // un AAD que ya no se podía reproducir.
  seal(plaintext: string, connectionId: string): SealedSecret {
    const key = this.getKey(CURRENT_KEY_VERSION);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(this.aad(connectionId));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext,
      iv,
      tag: cipher.getAuthTag(),
      keyVersion: CURRENT_KEY_VERSION,
    };
  }

  // Prueba con la clave actual y, si falla, con la anterior.
  //
  // Ese respaldo ES la rotación: el administrador pone la clave vieja en
  // INVESTMENTS_ENCRYPTION_KEY_PREVIOUS y la nueva en la actual, las filas
  // viejas siguen abriéndose, y `rotateBrokerCredentials` las vuelve a sellar
  // con la nueva sin cortar el servicio.
  open(sealed: SealedSecret, connectionId: string): string {
    const attempt = (key: Buffer): string => {
      const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
      decipher.setAAD(this.aad(connectionId));
      decipher.setAuthTag(sealed.tag);
      return Buffer.concat([
        decipher.update(sealed.ciphertext),
        decipher.final(),
      ]).toString('utf8');
    };

    try {
      return attempt(this.getKey(CURRENT_KEY_VERSION));
    } catch {
      // sigue
    }

    const previous = this.optionalKey(PREVIOUS_KEY_VERSION);
    if (previous) {
      try {
        return attempt(previous);
      } catch {
        // sigue
      }
    }

    // etiqueta inválida: o se manipuló la fila, o se movió de sitio, o ninguna
    // de las claves configuradas es la que cifró
    throw new InternalServerErrorException(
      'No se pudieron descifrar las credenciales del bróker. ' +
        'Comprueba INVESTMENTS_ENCRYPTION_KEY o vuelve a guardarlas.',
    );
  }

  // true si la fila se selló con una clave que ya no es la actual: sirve para
  // que la rotación sepa qué le queda por reencriptar.
  needsRotation(sealed: SealedSecret): boolean {
    return sealed.keyVersion !== CURRENT_KEY_VERSION;
  }

  sealJson(value: unknown, connectionId: string): SealedSecret {
    return this.seal(JSON.stringify(value), connectionId);
  }

  openJson<T>(sealed: SealedSecret, connectionId: string): T {
    return JSON.parse(this.open(sealed, connectionId)) as T;
  }

  // La clave se valida en el PRIMER USO, no al arrancar, igual que el cliente
  // de OpenAI: levantar el backend sin conexiones de bróker configuradas tiene
  // que seguir funcionando.
  private getKey(version: number): Buffer {
    const variable =
      version === CURRENT_KEY_VERSION
        ? 'INVESTMENTS_ENCRYPTION_KEY'
        : 'INVESTMENTS_ENCRYPTION_KEY_PREVIOUS';
    const raw = this.configService.get<string>(variable);
    if (!raw) {
      throw new ServiceUnavailableException(
        `Las conexiones con brókers no están configuradas (falta ${variable})`,
      );
    }
    // Exactamente 64 hex. NADA de derivar la clave de una frase con
    // PBKDF2/scrypt: invitaría a poner una contraseña débil donde hace falta
    // entropía de verdad.
    if (!/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
      throw new ServiceUnavailableException(
        `${variable} debe ser exactamente 64 caracteres hexadecimales (32 bytes). ` +
          'Genérala con: openssl rand -hex 32',
      );
    }
    return Buffer.from(raw.trim(), 'hex');
  }

  private optionalKey(version: number): Buffer | null {
    try {
      return this.getKey(version);
    } catch {
      return null;
    }
  }

  private aad(connectionId: string): Buffer {
    return Buffer.from(connectionId, 'utf8');
  }
}

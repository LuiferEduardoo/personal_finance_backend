import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CURRENT_KEY_VERSION, SecretBox } from './secret-box';

const KEY = randomBytes(32).toString('hex');
const OLD_KEY = randomBytes(32).toString('hex');
const CONNECTION = 'conn-1';

// OJO: nada de parámetro con valor por defecto. Pasar `undefined` de forma
// explícita dispararía el valor por defecto y la prueba de "sin clave"
// quedaría probando lo contrario de lo que dice.
function box(key?: string, previous?: string): SecretBox {
  return new SecretBox({
    get: (name: string) =>
      name === 'INVESTMENTS_ENCRYPTION_KEY'
        ? key
        : name === 'INVESTMENTS_ENCRYPTION_KEY_PREVIOUS'
          ? previous
          : undefined,
  } as unknown as ConfigService);
}

// caja con la clave válida por defecto
const withKey = (): SecretBox => box(KEY);

describe('SecretBox: ida y vuelta', () => {
  it('descifra lo que cifró', () => {
    const b = withKey();
    const sealed = b.seal('mi-contraseña-de-xtb', CONNECTION);
    expect(b.open(sealed, CONNECTION)).toBe('mi-contraseña-de-xtb');
  });

  it('el ciphertext NO contiene el texto plano', () => {
    const sealed = withKey().seal('SUPERSECRETO', CONNECTION);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('SUPERSECRETO');
    expect(sealed.ciphertext.toString('hex')).not.toContain(
      Buffer.from('SUPERSECRETO').toString('hex'),
    );
  });

  it('cifrar dos veces lo mismo da resultados distintos', () => {
    const b = withKey();
    const a = b.seal('igual', CONNECTION);
    const c = b.seal('igual', CONNECTION);
    // IV aleatorio por cifrado: si coincidieran, el esquema estaría roto
    expect(a.iv.equals(c.iv)).toBe(false);
    expect(a.ciphertext.equals(c.ciphertext)).toBe(false);
  });

  it('guarda y recupera objetos', () => {
    const b = withKey();
    const creds = { apiKey: 'k', apiSecret: 's', pairs: ['USDT', 'BTC'] };
    const sealed = b.sealJson(creds, CONNECTION);
    expect(b.openJson(sealed, CONNECTION)).toEqual(creds);
  });
});

describe('SecretBox: integridad', () => {
  it('un ciphertext manipulado falla, no devuelve basura', () => {
    const b = withKey();
    const sealed = b.seal('original', CONNECTION);
    sealed.ciphertext[0] ^= 0xff;
    expect(() => b.open(sealed, CONNECTION)).toThrow();
  });

  it('una etiqueta de autenticación manipulada falla', () => {
    const b = withKey();
    const sealed = b.seal('original', CONNECTION);
    sealed.tag[0] ^= 0xff;
    expect(() => b.open(sealed, CONNECTION)).toThrow();
  });

  it('el ciphertext NO se puede mover a otra conexión', () => {
    // esta es la razón de que el AAD lleve el connectionId: con acceso de
    // escritura a la base, mover credenciales de una fila a otra debe fallar
    const b = withKey();
    const sealed = b.seal('credenciales-de-conn-1', CONNECTION);
    expect(() => b.open(sealed, 'otra-conexion')).toThrow();
  });
});

describe('SecretBox: claves', () => {
  it('exige 64 caracteres hexadecimales', () => {
    expect(() => box('demasiado-corta').seal('x', CONNECTION)).toThrow(
      /64 caracteres hexadecimales/,
    );
    expect(() => box('z'.repeat(64)).seal('x', CONNECTION)).toThrow(
      /64 caracteres hexadecimales/,
    );
  });

  it('sin clave avisa de la variable que falta, no revienta al arrancar', () => {
    expect(() => box().seal('x', CONNECTION)).toThrow(
      /INVESTMENTS_ENCRYPTION_KEY/,
    );
    // `configured` permite al resto del backend arrancar sin ella
    expect(box().configured).toBe(false);
    expect(withKey().configured).toBe(true);
  });

  it('descifra lo sellado con la clave ANTERIOR durante una rotación', () => {
    // antes de rotar
    const sealed = box(OLD_KEY).seal('secreto-antiguo', CONNECTION);

    // después de rotar: la nueva es la actual, la vieja queda como previa.
    // La fila antigua tiene que seguir abriéndose sin cortar el servicio.
    const nuevo = box(KEY, OLD_KEY);
    expect(nuevo.open(sealed, CONNECTION)).toBe('secreto-antiguo');
  });

  it('sin la clave anterior configurada, la fila antigua ya no abre', () => {
    const sealed = box(OLD_KEY).seal('secreto-antiguo', CONNECTION);
    expect(() => box(KEY).open(sealed, CONNECTION)).toThrow();
  });

  it('una clave distinta no puede abrir el secreto', () => {
    const sealed = box(KEY).seal('secreto', CONNECTION);
    expect(() => box(OLD_KEY).open(sealed, CONNECTION)).toThrow();
  });

  it('marca la versión de clave con la que cifró', () => {
    expect(withKey().seal('x', CONNECTION).keyVersion).toBe(
      CURRENT_KEY_VERSION,
    );
  });
});

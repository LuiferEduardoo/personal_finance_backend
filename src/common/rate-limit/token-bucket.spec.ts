import { TokenBucket } from './token-bucket';

describe('TokenBucket: reserva por lotes', () => {
  it('no espera mientras quepa en la ventana', async () => {
    const bucket = new TokenBucket(100, 60_000);
    const t = Date.now();
    await bucket.take(20);
    await bucket.take(20);
    expect(Date.now() - t).toBeLessThan(50);
    expect(bucket.used).toBe(40);
  });

  // Antes los tokens se consumian de uno en uno y se esperaba por CADA uno:
  // una llamada de peso 20 con la ventana llena encadenaba veinte esperas.
  it('una peticion pesada espera UNA vez, no una por token', async () => {
    const bucket = new TokenBucket(10, 300);
    await bucket.take(10); // ventana llena

    const t = Date.now();
    await bucket.take(8);
    const transcurrido = Date.now() - t;

    // una sola ventana (~300 ms), no ocho
    expect(transcurrido).toBeGreaterThanOrEqual(250);
    expect(transcurrido).toBeLessThan(900);
  });

  it('libera capacidad al salir de la ventana', async () => {
    const bucket = new TokenBucket(5, 200);
    await bucket.take(5);
    expect(bucket.used).toBe(5);
    await new Promise((r) => setTimeout(r, 260));
    expect(bucket.used).toBe(0);
  });

  it('una peticion mayor que el tope no se bloquea para siempre', async () => {
    const bucket = new TokenBucket(5, 200);
    const t = Date.now();
    await bucket.take(50); // se acota al tope en vez de colgarse
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('cuenta lo consumido', async () => {
    const bucket = new TokenBucket(100, 60_000);
    await bucket.take();
    await bucket.take(4);
    expect(bucket.used).toBe(5);
  });
});

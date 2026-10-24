import { Logger } from '@nestjs/common';
import {
  CATEGORIZATION_CONCURRENCY,
  CategorizationQueue,
} from './categorization-queue';

// promesa que el test resuelve a mano
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('CategorizationQueue', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('enqueue vuelve de inmediato y la tarea corre después', async () => {
    const queue = new CategorizationQueue();
    const gate = deferred();
    const run = jest.fn(() => gate.promise);
    queue.enqueue('t', run);
    expect(queue.pending).toBe(1);
    gate.resolve();
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.pending).toBe(0);
  });

  it(`no corre más de ${CATEGORIZATION_CONCURRENCY} tareas a la vez`, async () => {
    const queue = new CategorizationQueue();
    const gates = Array.from({ length: 5 }, deferred);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    gates.forEach((gate, index) =>
      queue.enqueue(`t${index}`, async () => {
        started.push(index);
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      }),
    );
    expect(started).toEqual([0, 1, 2]);

    gates[0].resolve();
    await new Promise((r) => setImmediate(r));
    expect(started).toEqual([0, 1, 2, 3]);

    gates.forEach((gate) => gate.resolve());
    await queue.idle();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(CATEGORIZATION_CONCURRENCY);
  });

  it('aísla los fallos: se registran y las demás tareas siguen', async () => {
    const queue = new CategorizationQueue();
    const after = jest.fn().mockResolvedValue(undefined);
    queue.enqueue('rechaza', () => Promise.reject(new Error('529')));
    queue.enqueue('lanza', () => {
      throw new Error('síncrono');
    });
    queue.enqueue('sigue', after);
    await queue.idle();
    expect(after).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
    expect(queue.pending).toBe(0);
  });

  it('idle se resuelve enseguida si no hay nada pendiente', async () => {
    await expect(new CategorizationQueue().idle()).resolves.toBeUndefined();
  });

  it('drain espera a lo pendiente', async () => {
    const queue = new CategorizationQueue();
    const done = jest.fn();
    queue.enqueue('t', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done();
    });
    await expect(queue.drain(1_000)).resolves.toBe(true);
    expect(done).toHaveBeenCalled();
  });

  it('drain no cuelga el apagado: corta en el tope', async () => {
    const queue = new CategorizationQueue();
    queue.enqueue('colgada', () => new Promise<void>(() => {}));
    await expect(queue.drain(20)).resolves.toBe(false);
    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(queue.pending).toBe(1);
  });

  it('beforeApplicationShutdown drena la cola', async () => {
    const queue = new CategorizationQueue();
    const done = jest.fn();
    queue.enqueue('t', () => Promise.resolve().then(done));
    await queue.beforeApplicationShutdown();
    expect(done).toHaveBeenCalled();
  });
});

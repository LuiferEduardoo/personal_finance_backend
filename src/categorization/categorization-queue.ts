import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

// Cola en proceso para la clasificación en segundo plano (Gmail y registro
// manual). No hay Redis ni Bull en el proyecto: las tareas viven en memoria,
// así que una caída del proceso pierde las pendientes. El gasto ya está
// guardado cuando se encola, de modo que lo único que se pierde es la
// sugerencia de categoría.

// tareas a la vez: cada una es una petición a TypeSafe
export const CATEGORIZATION_CONCURRENCY = 3;
// tope de espera al apagar: un TypeSafe lento no puede colgar el cierre
export const CATEGORIZATION_SHUTDOWN_TIMEOUT_MS = 15_000;

interface QueuedTask {
  label: string;
  run: () => Promise<void>;
}

@Injectable()
export class CategorizationQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger(CategorizationQueue.name);
  private readonly waiting: QueuedTask[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  /**
   * Encola una tarea y vuelve de inmediato. Cualquier fallo se registra en el
   * log y se descarta: nunca llega al caller ni queda como promesa rechazada.
   */
  enqueue(label: string, run: () => Promise<void>): void {
    this.waiting.push({ label, run });
    this.pump();
  }

  // tareas en curso más las que esperan turno
  get pending(): number {
    return this.running + this.waiting.length;
  }

  // se resuelve cuando no queda nada en curso ni en espera (lo usan los tests)
  idle(): Promise<void> {
    if (this.pending === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // Al apagar se espera a lo pendiente, con un tope. Se usa "before" y no
  // "on" para que la conexión a la base de datos siga abierta mientras tanto.
  async beforeApplicationShutdown(): Promise<void> {
    await this.drain(CATEGORIZATION_SHUTDOWN_TIMEOUT_MS);
  }

  // true si quedó vacía antes del tope
  async drain(timeoutMs: number): Promise<boolean> {
    if (this.pending === 0) {
      return true;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const drained = await Promise.race([
      this.idle().then(() => true as const),
      timedOut,
    ]);
    clearTimeout(timer);
    if (!drained) {
      this.logger.warn(
        `Se cierra con ${this.pending} clasificaciones pendientes; se pierden`,
      );
    }
    return drained;
  }

  private pump(): void {
    while (
      this.running < CATEGORIZATION_CONCURRENCY &&
      this.waiting.length > 0
    ) {
      const task = this.waiting.shift()!;
      this.running++;
      void this.execute(task);
    }
  }

  private async execute(task: QueuedTask): Promise<void> {
    try {
      // dentro del try también se atrapa un throw síncrono de la tarea
      await task.run();
    } catch (error) {
      this.logger.error(
        `Falló la clasificación en segundo plano (${task.label}): ${(error as Error)?.message ?? String(error)}`,
      );
    } finally {
      this.running--;
      this.pump();
      if (this.pending === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    }
  }
}

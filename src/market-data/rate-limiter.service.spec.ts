import {
  MarketDataBudgetExhaustedError,
  MarketDataRateLimiter,
  UsageCounterStore,
  UsageSnapshot,
} from './rate-limiter.service';

// Doble en memoria del contador durable. Existe para poder probar la
// aritmética del presupuesto (vuelta de minuto, agotamiento diario) sin
// levantar Postgres.
class FakeCounterStore implements UsageCounterStore {
  minuteCredits = 0;
  dayCredits = 0;

  async addCredits(_provider: string, credits: number): Promise<UsageSnapshot> {
    this.minuteCredits += credits;
    this.dayCredits += credits;
    return this.snapshot();
  }

  async peek(): Promise<UsageSnapshot> {
    return this.snapshot();
  }

  /** simula el cambio de minuto: el contador del minuto vuelve a cero */
  rollMinute(): void {
    this.minuteCredits = 0;
  }

  private snapshot(): UsageSnapshot {
    return { minuteCredits: this.minuteCredits, dayCredits: this.dayCredits };
  }
}

function build(creditsPerMinute = 8, creditsPerDay = 800) {
  const store = new FakeCounterStore();
  const sleeps: number[] = [];
  const limiter = new MarketDataRateLimiter(store, undefined, {
    creditsPerMinute,
    creditsPerDay,
    provider: 'test',
    sleep: async (ms) => {
      sleeps.push(ms);
      // al dormir hasta el siguiente minuto, el contador del minuto se reinicia
      if (ms > 1000) {
        store.rollMinute();
      }
    },
  });
  return { store, limiter, sleeps };
}

describe('MarketDataRateLimiter: cobro de créditos', () => {
  it('cobra los créditos que consume la llamada', async () => {
    const { store, limiter } = build();
    await limiter.schedule(1, async () => 'ok');
    expect(store.dayCredits).toBe(1);

    await limiter.schedule(5, async () => 'ok');
    expect(store.dayCredits).toBe(6);
  });

  it('un lote de N símbolos cuesta N créditos, no 1', async () => {
    const { store, limiter } = build();
    // agrupar por comas ahorra viajes de red, NO créditos
    await limiter.schedule(8, async () => 'lote de 8 símbolos');
    expect(store.dayCredits).toBe(8);
  });

  it('espacia las llamadas dentro del minuto', async () => {
    const { limiter, sleeps } = build(8);
    await limiter.schedule(1, async () => 'ok');
    // 60000 / 8 = 7500 ms por crédito
    expect(sleeps).toContain(7500);
  });

  it('devuelve el valor de la llamada', async () => {
    const { limiter } = build();
    await expect(limiter.schedule(1, async () => 42)).resolves.toBe(42);
  });
});

describe('MarketDataRateLimiter: vuelta de minuto', () => {
  it('espera al siguiente minuto cuando el actual se llena', async () => {
    const { store, limiter, sleeps } = build(8);
    store.minuteCredits = 8;

    await limiter.schedule(1, async () => 'ok');

    // debe haber dormido una espera larga, hasta el cambio de minuto
    expect(sleeps.some((ms) => ms > 1000)).toBe(true);
    expect(store.dayCredits).toBe(1);
  });

  it('no espera si el minuto tiene hueco', async () => {
    const { store, limiter, sleeps } = build(8);
    store.minuteCredits = 2;

    await limiter.schedule(1, async () => 'ok');

    expect(sleeps.every((ms) => ms <= 7500)).toBe(true);
  });
});

describe('MarketDataRateLimiter: agotamiento diario', () => {
  it('lanza el error tipado cuando el día está gastado', async () => {
    const { store, limiter } = build(8, 800);
    store.dayCredits = 800;

    await expect(limiter.schedule(1, async () => 'ok')).rejects.toBeInstanceOf(
      MarketDataBudgetExhaustedError,
    );
  });

  it('no llama al proveedor si no hay presupuesto', async () => {
    const { store, limiter } = build(8, 800);
    store.dayCredits = 800;
    const call = jest.fn(async () => 'ok');

    await expect(limiter.schedule(1, call)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it('rechaza un lote que se pasaría del tope aunque quede algo', async () => {
    const { store, limiter } = build(8, 800);
    store.dayCredits = 795;

    // quedan 5 créditos y se piden 10
    await expect(limiter.schedule(10, async () => 'ok')).rejects.toBeInstanceOf(
      MarketDataBudgetExhaustedError,
    );
    expect(store.dayCredits).toBe(795);
  });

  it('el error lleva el consumo y el tope', async () => {
    const { store, limiter } = build(8, 800);
    store.dayCredits = 800;
    try {
      await limiter.schedule(1, async () => 'ok');
      throw new Error('debería haber lanzado');
    } catch (error) {
      const budget = error as MarketDataBudgetExhaustedError;
      expect(budget.dayCredits).toBe(800);
      expect(budget.dayLimit).toBe(800);
      expect(budget.message).toContain('800/800');
    }
  });

  it('remainingToday refleja lo que queda', async () => {
    const { store, limiter } = build(8, 800);
    expect(await limiter.remainingToday()).toBe(800);
    store.dayCredits = 754;
    expect(await limiter.remainingToday()).toBe(46);
    store.dayCredits = 900;
    expect(await limiter.remainingToday()).toBe(0);
  });
});

describe('MarketDataRateLimiter: serialización', () => {
  it('las llamadas se ejecutan en orden, no en paralelo', async () => {
    const { limiter } = build(60);
    const order: number[] = [];

    await Promise.all([
      limiter.schedule(1, async () => {
        order.push(1);
      }),
      limiter.schedule(1, async () => {
        order.push(2);
      }),
      limiter.schedule(1, async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('una llamada que falla no rompe la cola', async () => {
    const { limiter } = build(60);

    await expect(
      limiter.schedule(1, async () => {
        throw new Error('falló el proveedor');
      }),
    ).rejects.toThrow('falló el proveedor');

    await expect(limiter.schedule(1, async () => 'sigue viva')).resolves.toBe(
      'sigue viva',
    );
  });
});

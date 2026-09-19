// Limitador en memoria por ventana deslizante, para respetar los topes que
// impone cada broker.
//
// A diferencia del limitador de market-data, aqui NO hace falta contador
// durable: el tope es por conexion y por proceso, y pasarse solo cuesta un 429
// del broker, no agotar una cuota diaria comprada.
export class TokenBucket {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // Reserva `tokens` de capacidad esperando UNA sola vez lo necesario.
  //
  // La version anterior los consumia de uno en uno y esperaba por cada uno: una
  // llamada de peso 20 con la ventana llena se convertia en veinte esperas
  // encadenadas de hasta un minuto, y una sincronizacion normal tardaba veinte.
  // Aqui se calcula de golpe cuanto hay que esperar para que quepan todos.
  async take(tokens = 1): Promise<void> {
    const needed = Math.max(1, Math.min(tokens, this.limit));

    for (;;) {
      this.prune();
      if (this.hits.length + needed <= this.limit) {
        break;
      }
      // hay que liberar (hits + needed - limit) huecos: se espera a que salga de
      // la ventana el mas antiguo de los que estorban
      const toFree = this.hits.length + needed - this.limit;
      const oldest = this.hits[Math.min(toFree - 1, this.hits.length - 1)];
      const waitMs = this.windowMs - (Date.now() - oldest) + 5;
      if (waitMs <= 0) {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const now = Date.now();
    for (let i = 0; i < needed; i += 1) {
      this.hits.push(now);
    }
  }

  get used(): number {
    this.prune();
    return this.hits.length;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.hits.length > 0 && this.hits[0] <= cutoff) {
      this.hits.shift();
    }
  }
}

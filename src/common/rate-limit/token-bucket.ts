// Limitador en memoria por ventana deslizante, para respetar los topes que
// impone cada bróker.
//
// A diferencia del limitador de market-data, aquí NO hace falta contador
// durable: el tope es por conexión y por proceso, y pasarse solo cuesta un 429
// del bróker, no agotar una cuota diaria comprada.
export class TokenBucket {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // Espera lo justo para no pasarse del tope y registra el consumo.
  async take(tokens = 1): Promise<void> {
    for (let i = 0; i < tokens; i += 1) {
      await this.takeOne();
    }
  }

  private async takeOne(): Promise<void> {
    this.prune();
    if (this.hits.length >= this.limit) {
      // espera a que el hueco más antiguo salga de la ventana
      const waitMs = this.windowMs - (Date.now() - this.hits[0]) + 5;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.prune();
    }
    this.hits.push(Date.now());
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

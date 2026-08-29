export class ConnectionGenerationV1 {
  #generation = 0;
  #disposed = false;

  current(): number {
    return this.#generation;
  }

  advance(): number {
    if (this.#disposed || this.#generation >= Number.MAX_SAFE_INTEGER) {
      throw new Error("connection generation is disposed or exhausted");
    }
    this.#generation += 1;
    return this.#generation;
  }

  accepts(generation: number): boolean {
    return !this.#disposed && Number.isSafeInteger(generation) && generation > 0 && generation === this.#generation;
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
  }
}

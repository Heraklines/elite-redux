import type { PresentationSettlementOutcomeV1 } from "./reference-presentation-view";

export interface RenderSettlementTraceEntryV1 {
  sequence: number;
  event_id: string;
  generation: number;
  renderer: string;
  started_micros: number;
  completed_micros: number | null;
  outcome: PresentationSettlementOutcomeV1 | null;
}

export class PresentationSettlementTraceV1 {
  readonly #entries: RenderSettlementTraceEntryV1[] = [];
  readonly #pending = new Map<string, RenderSettlementTraceEntryV1>();
  readonly #now: () => number;
  #sequence = 0;
  #disposed = false;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  begin(eventId: string, generation: number, renderer: string): void {
    if (
      this.#disposed
      || this.#pending.has(eventId)
      || eventId.length === 0
      || !Number.isSafeInteger(generation)
      || generation <= 0
    ) {
      throw new Error("presentation settlement begin identity is invalid or duplicate");
    }
    this.#sequence += 1;
    const entry: RenderSettlementTraceEntryV1 = {
      sequence: this.#sequence,
      event_id: eventId,
      generation,
      renderer,
      started_micros: this.#micros(),
      completed_micros: null,
      outcome: null,
    };
    this.#entries.push(entry);
    this.#pending.set(eventId, entry);
  }

  settle(eventId: string, generation: number, outcome: PresentationSettlementOutcomeV1): void {
    const entry = this.#pending.get(eventId);
    if (this.#disposed || entry == null || entry.generation !== generation || entry.outcome != null) {
      throw new Error("presentation settlement is stale, missing, or duplicate");
    }
    entry.completed_micros = this.#micros();
    entry.outcome = outcome;
    this.#pending.delete(eventId);
  }

  snapshot(): readonly RenderSettlementTraceEntryV1[] {
    return this.#entries.map(entry => ({ ...entry }));
  }

  pendingCount(): number {
    return this.#pending.size;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    for (const entry of this.#pending.values()) {
      entry.completed_micros = this.#micros();
      entry.outcome = "FAILED";
    }
    this.#pending.clear();
    this.#disposed = true;
  }

  #micros(): number {
    const value = Math.floor(this.#now() * 1_000);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("presentation trace clock is invalid");
    }
    return value;
  }
}

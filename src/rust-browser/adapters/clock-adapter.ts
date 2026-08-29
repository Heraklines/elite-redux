import type { BrowserRequestV1 } from "../contracts/browser-contracts";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export interface BrowserClockAdapterOptions {
  emit(request: BrowserRequestV1): void;
  now?: () => number;
  setTimeout?: Window["setTimeout"];
  clearTimeout?: Window["clearTimeout"];
}

export class BrowserClockAdapter {
  readonly #emit: (request: BrowserRequestV1) => void;
  readonly #now: () => number;
  readonly #setTimeout: Window["setTimeout"];
  readonly #clearTimeout: Window["clearTimeout"];
  #lastMilliseconds: number;
  #generation = 0;
  #timer: number | null = null;
  #paused = false;
  #disposed = false;

  constructor(options: BrowserClockAdapterOptions) {
    this.#emit = options.emit;
    this.#now = options.now ?? (() => performance.now());
    this.#setTimeout = options.setTimeout ?? window.setTimeout.bind(window);
    this.#clearTimeout = options.clearTimeout ?? window.clearTimeout.bind(window);
    this.#lastMilliseconds = this.#validatedNow();
  }

  advance(): void {
    if (this.#disposed || this.#paused) {
      return;
    }
    const now = this.#validatedNow();
    const elapsed = Math.max(0, Math.floor(now - this.#lastMilliseconds));
    this.#lastMilliseconds = now;
    if (elapsed > 0) {
      this.#emit({ kind: "ADVANCE_TIME", value: elapsed });
    }
  }

  schedule(monotonicMicros: number | null): void {
    this.#cancelTimer();
    if (monotonicMicros == null || this.#disposed || this.#paused) {
      return;
    }
    if (!Number.isSafeInteger(monotonicMicros) || monotonicMicros < 0) {
      throw new Error("next wakeup is not a safe monotonic microsecond value");
    }
    const generation = ++this.#generation;
    const delay = Math.max(0, Math.ceil(monotonicMicros / 1000 - this.#validatedNow()));
    this.#timer = this.#setTimeout(() => {
      if (this.#disposed || this.#paused || generation !== this.#generation) {
        return;
      }
      this.#timer = null;
      this.advance();
      this.#emit({ kind: "TIMER_WAKEUP", value: { monotonic_micros: monotonicMicros } });
    }, delay);
  }

  pause(): void {
    if (this.#disposed || this.#paused) {
      return;
    }
    this.advance();
    this.#paused = true;
    this.#cancelTimer();
  }

  resume(): void {
    if (this.#disposed || !this.#paused) {
      return;
    }
    this.#paused = false;
    this.#lastMilliseconds = this.#validatedNow();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cancelTimer();
  }

  #cancelTimer(): void {
    this.#generation += 1;
    if (this.#timer != null) {
      this.#clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #validatedNow(): number {
    const value = this.#now();
    if (!Number.isFinite(value) || value < 0 || value > MAX_SAFE) {
      throw new Error("browser monotonic clock is outside the safe range");
    }
    return value;
  }
}

import type { Beat, InterBeatOverride } from "#data/llm-director/beat-schema";

/**
 * Pre-generation queue. Holds at most one in-flight generation plus the most
 * recently completed beat per wave. Beats are not persisted — on save/load the
 * queue resets and the first beat is regenerated on demand.
 *
 * `interBeatOverride` is a separate map keyed by wave: when a beat fires it can
 * tell the queue "for waves X+1 / X+2, swap the trainer like this." The vanilla
 * NewBattlePhase peeks at and consumes that override per wave (Task 18).
 */

export interface DirectorQueueOptions {
  generate: (wave: number) => Promise<Beat>;
}

export interface TryTakeOptions {
  timeoutMs: number;
}

interface PendingEntry {
  promise: Promise<Beat>;
  startedAt: number;
}

export class DirectorQueue {
  private readonly generate: (wave: number) => Promise<Beat>;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly ready = new Map<number, Beat>();
  private readonly interBeatOverrides = new Map<number, InterBeatOverride>();
  private cancelled = false;

  public constructor(opts: DirectorQueueOptions) {
    this.generate = opts.generate;
  }

  /**
   * Begin generating the beat for `wave`. Idempotent: a second call for the
   * same wave is a no-op while generation is in flight or already complete.
   */
  public kickOff(wave: number): void {
    if (this.cancelled) {
      return;
    }
    if (this.ready.has(wave) || this.pending.has(wave)) {
      return;
    }
    const startedAt = performance.now();
    const promise = this.generate(wave)
      .then(beat => {
        if (!this.cancelled) {
          this.ready.set(wave, beat);
        }
        this.pending.delete(wave);
        return beat;
      })
      .catch(err => {
        this.pending.delete(wave);
        throw err;
      });
    this.pending.set(wave, { promise, startedAt });
  }

  /**
   * Wait up to `timeoutMs` for the wave's beat. Returns null on timeout (caller
   * should fire a vanilla wave or filler beat). The pending generation
   * continues; if it eventually resolves, the result still lands in `ready`.
   */
  public async tryTake(wave: number, opts: TryTakeOptions): Promise<Beat | null> {
    if (this.cancelled) {
      return null;
    }
    const cached = this.ready.get(wave);
    if (cached) {
      this.ready.delete(wave);
      return cached;
    }
    const entry = this.pending.get(wave);
    if (!entry) {
      return null;
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => {
      timeoutHandle = setTimeout(() => resolve(null), opts.timeoutMs);
    });
    try {
      const beat = await Promise.race([entry.promise, timeout]);
      if (beat === null) {
        return null;
      }
      this.ready.delete(wave);
      return beat;
    } catch {
      return null;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  public setInterBeatOverride(wave: number, override: InterBeatOverride): void {
    this.interBeatOverrides.set(wave, override);
  }

  public takeInterBeatOverride(wave: number): InterBeatOverride | undefined {
    const v = this.interBeatOverrides.get(wave);
    if (v) {
      this.interBeatOverrides.delete(wave);
    }
    return v;
  }

  /** Diagnostic: are we still generating something for this wave? */
  public isPending(wave: number): boolean {
    return this.pending.has(wave);
  }

  /** Diagnostic: is the beat already buffered? */
  public isReady(wave: number): boolean {
    return this.ready.has(wave);
  }

  /**
   * Drop all pending and ready beats. Used on run end / mode swap.
   *
   * In-flight generations are not aborted (no cheap way to do that across the
   * `fetch` + retry stack); their results are simply dropped on resolve.
   */
  public cancel(): void {
    this.cancelled = true;
    this.pending.clear();
    this.ready.clear();
    this.interBeatOverrides.clear();
  }
}

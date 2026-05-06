import type { Beat, ConsequenceEffect, ConsequenceItem, InterBeatOverride } from "#data/llm-director/beat-schema";

/**
 * Slice of an InterBeatOverride that fires AFTER the wave's battle resolves
 * (win or loss). Stashed during NewBattlePhase, consumed by VictoryPhase or
 * FaintPhase, so post-battle narration & rewards stay tied to the LLM-
 * authored story instead of being thrown away once pre-battle text fires.
 */
export interface PostBattleHook {
  postWinText?: string;
  postLossText?: string;
  victoryRewards?: ConsequenceItem[];
  victoryEffects?: ConsequenceEffect[];
  defeatEffects?: ConsequenceEffect[];
}

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
  private generate: (wave: number) => Promise<Beat>;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly ready = new Map<number, Beat>();
  private readonly interBeatOverrides = new Map<number, InterBeatOverride>();
  private readonly postBattleHooks = new Map<number, PostBattleHook>();
  private cancelled = false;

  public constructor(opts: DirectorQueueOptions) {
    this.generate = opts.generate;
  }

  /**
   * Replace the generator function. Used by the bible phase once a story
   * bible exists, so the queue can call into `generateBeat` with the right
   * envelope. In-flight pending generations are unaffected.
   */
  public setGenerator(generate: (wave: number) => Promise<Beat>): void {
    this.generate = generate;
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

  public setPostBattleHook(wave: number, hook: PostBattleHook): void {
    this.postBattleHooks.set(wave, hook);
  }

  public takePostBattleHook(wave: number): PostBattleHook | undefined {
    const v = this.postBattleHooks.get(wave);
    if (v) {
      this.postBattleHooks.delete(wave);
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
    this.postBattleHooks.clear();
  }

  /**
   * Re-arm a previously cancelled queue. Used when starting a new Director
   * run on top of a runtime that was cancelled by an earlier run.
   */
  public reset(): void {
    this.cancelled = false;
    this.pending.clear();
    this.ready.clear();
    this.interBeatOverrides.clear();
    this.postBattleHooks.clear();
  }
}

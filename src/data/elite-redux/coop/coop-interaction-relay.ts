/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op ALTERNATING-INTERACTION relay (#633). The owner->watcher channel for the
// reward shop / biome shop / mystery-encounter screens.
//
// Same seed -> both clients independently generate the IDENTICAL option pool, so we
// never send the contents. We send only the OWNER's CHOICE (an index into that pool,
// or a sentinel); the WATCHER applies the same index to its own identical pool for
// the identical outcome (same item, same money spent, same ME branch). This is the
// lockstep-input model that fixed the battle command relay, applied to interactions.
//
// Multi-pick screens (a shop where the owner buys several things, then leaves) stream
// a SEQUENCE of choices for one interaction `seq`, ending in a leave sentinel - so
// the relay is FIFO PER seq (NOT latest-wins like the per-turn battle stream): the
// watcher pulls them in order. A choice that arrives before its waiter is buffered;
// a waiter that times out resolves null (the watcher then leaves, never hangs). A
// choice for a stale/old `seq` is buffered harmlessly and never consumed.
//
// Engine-FREE (transport + wire types only) so it is unit-testable headlessly over a
// LoopbackTransport, exactly like CoopBattleStreamer.
// =============================================================================

import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Sentinel choices shared across interaction screens. */
export const COOP_INTERACTION_LEAVE = -1;
export const COOP_INTERACTION_REROLL = -2;

/** One relayed owner choice the watcher applies to its identical pool. */
export interface CoopInteractionChoice {
  /** Picked option index, or a sentinel (COOP_INTERACTION_LEAVE / _REROLL). */
  choice: number;
  /** Optional extra indices (party-target slot, ME sub-option); undefined when none. */
  data: number[] | undefined;
}

/** Options for {@linkcode CoopInteractionRelay} (timer injection for tests). */
export interface CoopInteractionRelayOptions {
  /** How long the watcher waits for the owner's next choice before giving up. Default 180s. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

// The owner is a human shopping / reading an ME, so the watcher's wait must comfortably
// exceed human deliberation - a premature timeout makes the watcher LEAVE while the owner
// is still deciding (desync). 20min effectively means "wait for the human"; a timeout is
// then only a genuinely-disconnected-partner safety net, not a deliberation timer.
const DEFAULT_TIMEOUT_MS = 1_200_000;

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * Rides a {@linkcode CoopTransport} to relay alternating-interaction choices. One
 * instance per client. The OWNER calls {@linkcode sendInteractionChoice} per pick;
 * the WATCHER `await`s {@linkcode awaitInteractionChoice} in a loop until a leave
 * sentinel.
 */
export class CoopInteractionRelay {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly offMessage: () => void;

  /** seq -> FIFO queue of choices that arrived before their waiter. */
  private readonly inbox = new Map<number, CoopInteractionChoice[]>();
  /** seq -> resolver for the in-flight {@linkcode awaitInteractionChoice} (one at a time). */
  private readonly pending = new Map<number, (res: CoopInteractionChoice | null) => void>();

  constructor(transport: CoopTransport, opts: CoopInteractionRelayOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /** OWNER: send one pick for interaction `seq` (`kind` is routing/logging only). */
  sendInteractionChoice(seq: number, kind: string, choice: number, data?: number[]): void {
    this.transport.send({
      t: "interactionChoice",
      seq,
      kind,
      choice,
      ...(data === undefined ? {} : { data }),
    });
  }

  /**
   * WATCHER: take the next owner choice for interaction `seq` (FIFO). Resolves
   * immediately if one is already buffered, else waits for the next to arrive, or
   * resolves `null` on timeout (the watcher then leaves the screen, never hangs).
   */
  awaitInteractionChoice(seq: number, timeoutMs = this.timeoutMs): Promise<CoopInteractionChoice | null> {
    const queue = this.inbox.get(seq);
    if (queue !== undefined && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) {
        this.inbox.delete(seq);
      }
      return Promise.resolve(next);
    }
    // Supersede any stale waiter parked on this seq.
    this.pending.get(seq)?.(null);
    return new Promise<CoopInteractionChoice | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopInteractionChoice | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(seq) === finish) {
          this.pending.delete(seq);
        }
        resolve(res);
      };
      this.pending.set(seq, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** Stop listening and fail any in-flight waits. */
  dispose(): void {
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.inbox.clear();
  }

  private handle(msg: CoopMessage): void {
    if (msg.t !== "interactionChoice") {
      return;
    }
    const choice: CoopInteractionChoice = { choice: msg.choice, data: msg.data };
    const waiter = this.pending.get(msg.seq);
    if (waiter) {
      waiter(choice);
      return;
    }
    // No waiter yet - buffer FIFO for the next awaitInteractionChoice(seq).
    const queue = this.inbox.get(msg.seq) ?? [];
    queue.push(choice);
    this.inbox.set(msg.seq, queue);
  }
}

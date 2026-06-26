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

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopInteractionOutcome,
  CoopMessage,
  CoopSerializedRewardOption,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";

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

/** Compact, log-safe one-line summary of a relayed choice (never dumps a blob). */
function summarizeChoice(c: CoopInteractionChoice): string {
  return `choice=${c.choice} data=${c.data === undefined ? "-" : `[${c.data.join(",")}]`}`;
}

/** Compact, log-safe one-line summary of a host-resolved interaction outcome (discriminated by `k`). */
function summarizeOutcome(o: CoopInteractionOutcome): string {
  switch (o.k) {
    case "rewardGrant":
      return `k=rewardGrant id=${o.modifierTypeId} slot=${o.partySlot} money=${o.moneyDelta} args=${o.args.length}`;
    case "reroll":
      return `k=reroll money=${o.moneyDelta}`;
    case "leave":
      return "k=leave";
    case "mePresent":
      return `k=mePresent opts=${o.meetsReqs.length}${o.subPrompt ? ` +subPrompt(${o.subPrompt.kind})` : ""}`;
    default:
      return `k=${(o as { k?: string }).k ?? "?"}`;
  }
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
  /** seq -> FIFO queue of OUTCOMES that arrived before their waiter (#633, TRACK-2 Phase C). */
  private readonly outcomeInbox = new Map<number, CoopInteractionOutcome[]>();
  /** seq -> resolver for the in-flight {@linkcode awaitInteractionOutcome} (one at a time). */
  private readonly outcomePending = new Map<number, (res: CoopInteractionOutcome | null) => void>();

  /** "seq:reroll" -> the owner's rolled reward-option list that arrived before its waiter (#633 Fix #2). */
  private readonly rewardOptionsInbox = new Map<string, CoopSerializedRewardOption[]>();
  /** "seq:reroll" -> resolver for the in-flight {@linkcode awaitRewardOptions}. */
  private readonly rewardOptionsPending = new Map<string, (res: CoopSerializedRewardOption[] | null) => void>();

  constructor(transport: CoopTransport, opts: CoopInteractionRelayOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /** OWNER: send one pick for interaction `seq` (`kind` is routing/logging only). */
  sendInteractionChoice(seq: number, kind: string, choice: number, data?: number[]): void {
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `SEND interactionChoice seq=${seq} kind=${kind} ${summarizeChoice({ choice, data })}`,
      );
    }
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
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `AWAIT interactionChoice seq=${seq} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve ${summarizeChoice(next)}`,
        );
      }
      return Promise.resolve(next);
    }
    coopLog("relay", `AWAIT interactionChoice seq=${seq} timeoutMs=${timeoutMs} -> network-wait`);
    // Supersede any stale waiter parked on this seq.
    if (this.pending.has(seq)) {
      coopWarn("relay", `AWAIT interactionChoice seq=${seq} SUPERSEDE stale waiter -> resolved null`);
    }
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
        if (res === null) {
          coopWarn("relay", `AWAIT interactionChoice seq=${seq} RESOLVE null (TIMEOUT or supersede) -> watcher leaves`);
        } else {
          coopLog("relay", `AWAIT interactionChoice seq=${seq} RESOLVE ${summarizeChoice(res)}`);
        }
        resolve(res);
      };
      this.pending.set(seq, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /**
   * OWNER (#633, TRACK-2 Phase C): stream the HOST-resolved authoritative OUTCOME of one
   * pick for interaction `seq` (`kind` is routing/logging only). The watcher adopts it
   * verbatim instead of re-deriving from its own pool, so a pool divergence can never
   * change the result. Same FIFO-per-seq semantics as the choice relay.
   */
  sendInteractionOutcome(seq: number, kind: string, outcome: CoopInteractionOutcome): void {
    if (isCoopDebug()) {
      coopLog("relay", `SEND interactionOutcome seq=${seq} kind=${kind} ${summarizeOutcome(outcome)}`);
    }
    this.transport.send({ t: "interactionOutcome", seq, kind, outcome });
  }

  /**
   * WATCHER (#633, TRACK-2 Phase C): take the next host-resolved outcome for interaction
   * `seq` (FIFO). Resolves immediately if one is buffered, else waits for the next, or
   * resolves `null` on timeout (the watcher then leaves, never hangs). Mirrors
   * {@linkcode awaitInteractionChoice} exactly.
   */
  awaitInteractionOutcome(seq: number, timeoutMs = this.timeoutMs): Promise<CoopInteractionOutcome | null> {
    const queue = this.outcomeInbox.get(seq);
    if (queue !== undefined && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) {
        this.outcomeInbox.delete(seq);
      }
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `AWAIT interactionOutcome seq=${seq} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve ${summarizeOutcome(next)}`,
        );
      }
      return Promise.resolve(next);
    }
    coopLog("relay", `AWAIT interactionOutcome seq=${seq} timeoutMs=${timeoutMs} -> network-wait`);
    // Supersede any stale waiter parked on this seq.
    if (this.outcomePending.has(seq)) {
      coopWarn("relay", `AWAIT interactionOutcome seq=${seq} SUPERSEDE stale waiter -> resolved null`);
    }
    this.outcomePending.get(seq)?.(null);
    return new Promise<CoopInteractionOutcome | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopInteractionOutcome | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.outcomePending.get(seq) === finish) {
          this.outcomePending.delete(seq);
        }
        if (res === null) {
          coopWarn("relay", `AWAIT interactionOutcome seq=${seq} RESOLVE null (TIMEOUT or supersede) -> watcher leaves`);
        } else {
          coopLog("relay", `AWAIT interactionOutcome seq=${seq} RESOLVE ${summarizeOutcome(res)}`);
        }
        resolve(res);
      };
      this.outcomePending.set(seq, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** OWNER: stream the exact reward-option list rolled for `seq` / `reroll` (#633 Fix #2). */
  sendRewardOptions(seq: number, reroll: number, options: CoopSerializedRewardOption[]): void {
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `SEND rewardOptions seq=${seq} reroll=${reroll} count=${options.length} ids=[${options.map(o => o.id).join(",")}]`,
      );
    }
    this.transport.send({ t: "rewardOptions", seq, reroll, options });
  }

  /**
   * WATCHER: take the owner's rolled reward-option list for `seq` / `reroll`. Resolves
   * immediately if it already arrived (buffered), else waits for it, or resolves `null`
   * on timeout (the watcher then falls back to its own locally-rolled options - divergent
   * but never a hang).
   */
  awaitRewardOptions(
    seq: number,
    reroll: number,
    timeoutMs = this.timeoutMs,
  ): Promise<CoopSerializedRewardOption[] | null> {
    const key = `${seq}:${reroll}`;
    const buffered = this.rewardOptionsInbox.get(key);
    if (buffered !== undefined) {
      this.rewardOptionsInbox.delete(key);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `AWAIT rewardOptions key=${key} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve count=${buffered.length}`,
        );
      }
      return Promise.resolve(buffered);
    }
    coopLog("relay", `AWAIT rewardOptions key=${key} timeoutMs=${timeoutMs} -> network-wait`);
    // Supersede any stale waiter on this key.
    if (this.rewardOptionsPending.has(key)) {
      coopWarn("relay", `AWAIT rewardOptions key=${key} SUPERSEDE stale waiter -> resolved null`);
    }
    this.rewardOptionsPending.get(key)?.(null);
    return new Promise<CoopSerializedRewardOption[] | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopSerializedRewardOption[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.rewardOptionsPending.get(key) === finish) {
          this.rewardOptionsPending.delete(key);
        }
        if (res === null) {
          coopWarn(
            "relay",
            `AWAIT rewardOptions key=${key} RESOLVE null (TIMEOUT or supersede) -> watcher falls back to own roll (DIVERGENT)`,
          );
        } else {
          coopLog("relay", `AWAIT rewardOptions key=${key} RESOLVE count=${res.length}`);
        }
        resolve(res);
      };
      this.rewardOptionsPending.set(key, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** Stop listening and fail any in-flight waits. */
  dispose(): void {
    const inFlight = this.pending.size + this.outcomePending.size + this.rewardOptionsPending.size;
    if (inFlight > 0) {
      coopWarn(
        "relay",
        `dispose() failing inFlightWaiters=${inFlight} (choice=${this.pending.size} outcome=${this.outcomePending.size} rewardOptions=${this.rewardOptionsPending.size}) -> all resolve null`,
      );
    } else {
      coopLog("relay", "dispose() (no in-flight waiters)");
    }
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    for (const finish of [...this.outcomePending.values()]) {
      finish(null);
    }
    for (const finish of [...this.rewardOptionsPending.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.inbox.clear();
    this.outcomePending.clear();
    this.outcomeInbox.clear();
    this.rewardOptionsPending.clear();
    this.rewardOptionsInbox.clear();
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "interactionOutcome") {
      const waiter = this.outcomePending.get(msg.seq);
      if (waiter) {
        if (isCoopDebug()) {
          coopLog("relay", `RECV interactionOutcome seq=${msg.seq} -> deliver-to-waiter ${summarizeOutcome(msg.outcome)}`);
        }
        waiter(msg.outcome);
        return;
      }
      // No waiter yet - buffer FIFO for the next awaitInteractionOutcome(seq).
      const queue = this.outcomeInbox.get(msg.seq) ?? [];
      queue.push(msg.outcome);
      this.outcomeInbox.set(msg.seq, queue);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `RECV interactionOutcome seq=${msg.seq} -> BUFFER outcomeInbox depth=${queue.length} ${summarizeOutcome(msg.outcome)}`,
        );
      }
      return;
    }
    if (msg.t === "rewardOptions") {
      const key = `${msg.seq}:${msg.reroll}`;
      const waiter = this.rewardOptionsPending.get(key);
      if (waiter) {
        if (isCoopDebug()) {
          coopLog("relay", `RECV rewardOptions key=${key} -> deliver-to-waiter count=${msg.options.length}`);
        }
        waiter(msg.options);
        return;
      }
      // No waiter yet - buffer (latest wins per key) for the next awaitRewardOptions.
      this.rewardOptionsInbox.set(key, msg.options);
      if (isCoopDebug()) {
        coopLog("relay", `RECV rewardOptions key=${key} -> BUFFER rewardOptionsInbox (latest-wins) count=${msg.options.length}`);
      }
      return;
    }
    if (msg.t !== "interactionChoice") {
      return;
    }
    const choice: CoopInteractionChoice = { choice: msg.choice, data: msg.data };
    const waiter = this.pending.get(msg.seq);
    if (waiter) {
      if (isCoopDebug()) {
        coopLog("relay", `RECV interactionChoice seq=${msg.seq} -> deliver-to-waiter ${summarizeChoice(choice)}`);
      }
      waiter(choice);
      return;
    }
    // No waiter yet - buffer FIFO for the next awaitInteractionChoice(seq).
    const queue = this.inbox.get(msg.seq) ?? [];
    queue.push(choice);
    this.inbox.set(msg.seq, queue);
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `RECV interactionChoice seq=${msg.seq} -> BUFFER inbox depth=${queue.length} ${summarizeChoice(choice)}`,
      );
    }
  }
}

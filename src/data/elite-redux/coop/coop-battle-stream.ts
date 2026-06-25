/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op host-authoritative battle STREAM (#633, LIVE-D). The host->guest half of
// the new battle model: the host is the sole resolution engine and STREAMS its
// outcomes; the guest renders them and never computes.
//
//   HOST  sends: `enemyPartySync` (the exact enemy party at encounter), then per
//         turn a `turnResolution` (ordered visible events + an authoritative
//         post-turn checkpoint), plus out-of-turn `battleCheckpoint`s.
//   GUEST awaits each turn's resolution, renders the events, and applies the
//         checkpoint so its state matches the host EXACTLY. It rolls no RNG and
//         resolves nothing, so it cannot desync.
//
// Engine-FREE (transport + wire types only), so the whole stream layer is unit-
// testable headlessly over a LoopbackTransport - the same protocol then runs
// unchanged over the real WebRTC transport. The engine-coupled serialize/apply of
// a checkpoint lives in `coop-battle-checkpoint.ts`; this file is just the wire.
// =============================================================================

import type {
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopMessage,
  CoopSerializedEnemy,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";

/** A fully-resolved turn the guest renders: ordered events + the authoritative state. */
export interface CoopTurnResolution {
  turn: number;
  events: CoopBattleEvent[];
  checkpoint: CoopBattleCheckpoint;
}

/** Options for {@linkcode CoopBattleStreamer} (timer injection for tests). */
export interface CoopBattleStreamerOptions {
  /** How long the guest waits for a turn's resolution before giving up. Default 60s. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

// The host runs the WHOLE turn before it can send the resolution - and a turn does
// not resolve until BOTH players' commands are in, which itself waits up to the 20min
// partner-command grace (coop-battle-sync). So the guest's wait MUST exceed that, or a
// slow thinker trips this 60s give-up and the guest desyncs (one player lands in the
// shop while the other is still choosing). Match the 20min command grace.
const DEFAULT_TIMEOUT_MS = 1_200_000;

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * Rides on a {@linkcode CoopTransport} to stream host-authoritative battle state to
 * the guest. One instance per client. The HOST calls the `send*` methods; the GUEST
 * registers `onEnemyPartySync` / `onCheckpoint` and `await`s {@linkcode awaitTurn}.
 *
 * Turn resolutions are matched by `turn`. Because the two clients are NOT time-locked
 * (the host may finish + send turn N before the guest reaches its await), a resolution
 * that arrives with no waiter is BUFFERED (latest-per-turn wins) and consumed by the
 * next {@linkcode awaitTurn} for that turn - the same race fix the command relay uses.
 */
export class CoopBattleStreamer {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly offMessage: () => void;

  /** turn -> resolver for an in-flight {@linkcode awaitTurn}. */
  private readonly pending = new Map<number, (res: CoopTurnResolution | null) => void>();
  /** turn -> a resolution that arrived before its waiter (race buffer). */
  private readonly inbox = new Map<number, CoopTurnResolution>();

  private enemyPartyHandler: ((wave: number, enemies: CoopSerializedEnemy[]) => void) | null = null;
  private checkpointHandler: ((reason: string, checkpoint: CoopBattleCheckpoint) => void) | null = null;
  /** wave -> resolver for an in-flight {@linkcode awaitEnemyParty}. */
  private readonly enemyPartyWaiters = new Map<number, (res: CoopSerializedEnemy[] | null) => void>();
  /** Latest authoritative checkpoint the guest has not yet applied (consumed at a turn boundary). */
  private lastCheckpoint: CoopBattleCheckpoint | null = null;
  /** Latest enemy party the guest has not yet adopted (consumed at the wave's first turn). */
  private lastEnemyParty: { wave: number; enemies: CoopSerializedEnemy[] } | null = null;

  constructor(transport: CoopTransport, opts: CoopBattleStreamerOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  // --- HOST side --------------------------------------------------------------

  /** HOST: send the exact enemy party the guest must adopt verbatim for `wave`. */
  sendEnemyParty(wave: number, enemies: CoopSerializedEnemy[]): void {
    this.transport.send({ t: "enemyPartySync", wave, enemies });
  }

  /** HOST: send a fully-resolved turn (ordered events + authoritative checkpoint). */
  emitTurn(turn: number, events: CoopBattleEvent[], checkpoint: CoopBattleCheckpoint): void {
    this.transport.send({ t: "turnResolution", turn, events, checkpoint });
  }

  /** HOST: send an out-of-turn authoritative checkpoint (after a switch / capture / resume). */
  sendCheckpoint(reason: string, checkpoint: CoopBattleCheckpoint): void {
    this.transport.send({ t: "battleCheckpoint", reason, checkpoint });
  }

  // --- GUEST side -------------------------------------------------------------

  /** GUEST: handle the host's enemy party (adopt it verbatim). */
  onEnemyPartySync(handler: (wave: number, enemies: CoopSerializedEnemy[]) => void): void {
    this.enemyPartyHandler = handler;
  }

  /**
   * GUEST: take + clear the latest enemy party the host streamed for `wave`, if any.
   * Returns null when none is buffered or it is for a different wave (so the guest
   * never adopts a stale wave's enemies). Applied at the wave's first turn boundary.
   */
  consumeEnemyParty(wave: number): CoopSerializedEnemy[] | null {
    const buffered = this.lastEnemyParty;
    if (buffered == null || buffered.wave !== wave) {
      return null;
    }
    this.lastEnemyParty = null;
    return buffered.enemies;
  }

  /**
   * GUEST: await the host's authoritative enemy party for `wave` (#633, LIVE-D6).
   * Resolves immediately with the buffered party if the host already sent it, else
   * waits for it to arrive, or resolves `null` on timeout (the guest then falls back
   * to generating its own enemies - divergent but never a hang). The guest calls this
   * at encounter time, BEFORE building its own party, so it adopts the host's enemies
   * verbatim and the two clients fight identical mons (species included). The host
   * only knows its enemies AFTER it clears its own save-slot screen, so a real wait
   * is expected; the timeout is generous.
   */
  awaitEnemyParty(wave: number, timeoutMs = this.timeoutMs): Promise<CoopSerializedEnemy[] | null> {
    // Already buffered for this wave -> consume + return immediately.
    const buffered = this.consumeEnemyParty(wave);
    if (buffered != null) {
      return Promise.resolve(buffered);
    }
    // Supersede any stale waiter for this wave.
    this.enemyPartyWaiters.get(wave)?.(null);
    return new Promise<CoopSerializedEnemy[] | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopSerializedEnemy[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.enemyPartyWaiters.get(wave) === finish) {
          this.enemyPartyWaiters.delete(wave);
        }
        resolve(res);
      };
      this.enemyPartyWaiters.set(wave, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** GUEST: handle an out-of-turn authoritative checkpoint. */
  onCheckpoint(handler: (reason: string, checkpoint: CoopBattleCheckpoint) => void): void {
    this.checkpointHandler = handler;
  }

  /**
   * GUEST: take + clear the latest authoritative checkpoint, if any. The guest applies
   * it at a SAFE turn boundary (start of its next command phase) rather than mid-
   * resolution, so a snap to the host's post-turn state can never fight a running phase.
   */
  consumeCheckpoint(): CoopBattleCheckpoint | null {
    const cp = this.lastCheckpoint;
    this.lastCheckpoint = null;
    return cp;
  }

  /**
   * GUEST: await the host's resolution for `turn`. Resolves with the streamed turn,
   * or `null` if it does not arrive within the timeout (the guest then shows a
   * "waiting for host" notice and applies the next checkpoint when it lands). If the
   * host already sent it (race), the buffered resolution returns immediately.
   */
  awaitTurn(turn: number): Promise<CoopTurnResolution | null> {
    // Supersede any stale waiter for this turn.
    this.pending.get(turn)?.(null);
    const buffered = this.inbox.get(turn);
    if (buffered !== undefined) {
      this.inbox.delete(turn);
      return Promise.resolve(buffered);
    }
    return new Promise<CoopTurnResolution | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopTurnResolution | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(turn) === finish) {
          this.pending.delete(turn);
        }
        resolve(res);
      };
      this.pending.set(turn, finish);
      cancelTimer = this.schedule(() => finish(null), this.timeoutMs);
    });
  }

  // --- shared -----------------------------------------------------------------

  /** Stop listening and fail any in-flight awaits. */
  dispose(): void {
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    for (const finish of [...this.enemyPartyWaiters.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.enemyPartyWaiters.clear();
    this.inbox.clear();
    this.lastCheckpoint = null;
    this.lastEnemyParty = null;
    this.enemyPartyHandler = null;
    this.checkpointHandler = null;
  }

  private handle(msg: CoopMessage): void {
    switch (msg.t) {
      case "enemyPartySync": {
        // Hand it straight to a parked awaitEnemyParty (consumed), else buffer for the
        // next consume/await. Either way fire any live handler.
        const waiter = this.enemyPartyWaiters.get(msg.wave);
        if (waiter) {
          this.lastEnemyParty = null;
          this.enemyPartyHandler?.(msg.wave, msg.enemies);
          waiter(msg.enemies);
          return;
        }
        this.lastEnemyParty = { wave: msg.wave, enemies: msg.enemies };
        this.enemyPartyHandler?.(msg.wave, msg.enemies);
        return;
      }
      case "turnResolution": {
        const res: CoopTurnResolution = { turn: msg.turn, events: msg.events, checkpoint: msg.checkpoint };
        const resolver = this.pending.get(msg.turn);
        if (resolver) {
          resolver(res);
        } else {
          // No waiter yet - buffer (latest per turn wins) for the next awaitTurn.
          this.inbox.set(msg.turn, res);
        }
        return;
      }
      case "battleCheckpoint":
        this.checkpointHandler?.(msg.reason, msg.checkpoint);
        return;
      default:
        // Not a stream message - ignored (other layers handle ping/command/etc.).
        return;
    }
  }
}

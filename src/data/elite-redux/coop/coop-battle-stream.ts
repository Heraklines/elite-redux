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
  CoopWaveOutcome,
} from "#data/elite-redux/coop/coop-transport";
// TYPE-ONLY (erased at runtime): the host's ghost-team pool the guest adopts (#633).
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";

/** A fully-resolved turn the guest renders: ordered events + the authoritative state. */
export interface CoopTurnResolution {
  turn: number;
  events: CoopBattleEvent[];
  checkpoint: CoopBattleCheckpoint;
  /** The host's full-state checksum at this boundary (#633, TRACK-2). */
  checksum: string;
  /** The host's canonical state pre-image the `checksum` hashed (#633, diagnostics); optional. */
  preimage?: string;
}

/** An out-of-turn authoritative checkpoint + the host's matching full-state checksum. */
export interface CoopCheckpointEnvelope {
  reason: string;
  checkpoint: CoopBattleCheckpoint;
  /** The host's full-state checksum at this boundary (#633, TRACK-2). */
  checksum: string;
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
  /** ME-battle key -> resolver for an in-flight {@linkcode awaitMeBattleEnemyParty} (#633 ME handoff). */
  private readonly meBattlePartyWaiters = new Map<string, (res: CoopSerializedEnemy[] | null) => void>();
  /** ME-battle key -> a party that arrived before its waiter (race buffer, #633 ME handoff). */
  private readonly meBattlePartyInbox = new Map<string, CoopSerializedEnemy[]>();
  /** Latest authoritative checkpoint (+ checksum) the guest has not yet applied. */
  private lastCheckpoint: CoopCheckpointEnvelope | null = null;
  /** Latest enemy party the guest has not yet adopted (consumed at the wave's first turn). */
  private lastEnemyParty: { wave: number; enemies: CoopSerializedEnemy[] } | null = null;
  /** GUEST: handler for the host's authoritative ghost-team pool (#633 ghost-pool sync). */
  private ghostPoolHandler: ((pool: GhostTeamSnapshot[]) => void) | null = null;
  /** GUEST: the host's ghost pool that arrived before a handler subscribed (delivered on subscribe). */
  private lastGhostPool: GhostTeamSnapshot[] | null = null;
  /** HOST: handler answering the guest's `requestStateSync` (#633, TRACK-2 resync). */
  private stateSyncRequestHandler: ((turn: number, seq: number) => void) | null = null;
  /** GUEST: seq -> resolver for an in-flight {@linkcode awaitStateSync}. */
  private readonly stateSyncWaiters = new Map<number, (blob: string | null) => void>();
  /** GUEST: a `stateSync` blob that arrived before its waiter (race buffer), keyed by seq. */
  private readonly stateSyncInbox = new Map<number, string>();
  /** GUEST: monotonic resync request counter (each desync request bumps it). */
  private stateSyncSeq = 0;
  /** WATCHER: handler for the owner's ME-boundary checksum (#633, TRACK-2 Phase C). */
  private meChecksumHandler: ((seq: number, checksum: string) => void) | null = null;
  /** GUEST: handler for the host's wave-resolved signal (#633, authoritative wave-advance). */
  private waveResolvedHandler: ((wave: number, outcome: CoopWaveOutcome) => void) | null = null;

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

  /**
   * HOST (#633, authoritative ME battle handoff): send the exact enemy party the guest must
   * adopt verbatim for a mystery-encounter-SPAWNED battle, keyed by the ME interaction `key`
   * (see `meBattleHandoffKey`) rather than a plain waveIndex - the battle spawns MID-wave, so
   * the wave key would collide with the wave's own encounter party. The guest discards its
   * locally-rolled ME party and adopts these, so the spawned boss is host-authoritative
   * regardless of who OWNED the encounter.
   */
  sendMeBattleEnemyParty(key: string, enemies: CoopSerializedEnemy[]): void {
    this.transport.send({ t: "meBattleEnemyPartySync", key, enemies });
  }

  /**
   * HOST: broadcast the authoritative ghost-team pool (#633). Ghost teams are fetched
   * per-client from the shared server pool, so the two clients otherwise field divergent
   * ghosts. The guest adopts this pool verbatim (and skips its own fetch), making
   * `takeGhostForWave`'s seeded pick deterministic on both. Sent once on prefetch-resolve.
   */
  sendGhostPool(pool: GhostTeamSnapshot[]): void {
    this.transport.send({ t: "ghostPool", pool });
  }

  /**
   * HOST: send a fully-resolved turn (ordered events + authoritative checkpoint + the
   * host's full-state `checksum` the guest verifies against, #633 TRACK-2). The optional
   * `preimage` is the canonical state string the checksum hashed (#633, diagnostics); when
   * present the guest can deep-diff it against its own on a mismatch to find the drift field.
   */
  emitTurn(
    turn: number,
    events: CoopBattleEvent[],
    checkpoint: CoopBattleCheckpoint,
    checksum: string,
    preimage?: string,
  ): void {
    this.transport.send({
      t: "turnResolution",
      turn,
      events,
      checkpoint,
      checksum,
      ...(preimage === undefined ? {} : { preimage }),
    });
  }

  /**
   * HOST: send an out-of-turn authoritative checkpoint (after a switch / capture / resume),
   * stamped with the host's full-state `checksum` for the guest to verify (#633, TRACK-2).
   */
  sendCheckpoint(reason: string, checkpoint: CoopBattleCheckpoint, checksum: string): void {
    this.transport.send({ t: "battleCheckpoint", reason, checkpoint, checksum });
  }

  /** HOST: send the authoritative full-state snapshot answering a guest's `requestStateSync`. */
  sendStateSync(blob: string, seq: number): void {
    this.transport.send({ t: "stateSync", blob, seq });
  }

  /**
   * HOST: signal that the host RESOLVED the `wave`'s battle end (#633, authoritative
   * wave-advance handshake). The guest - a pure renderer that removes KOd enemies without a
   * FaintPhase - uses this to run the normal post-battle tail and reach the next wave (it
   * would otherwise loop the won wave forever). `outcome` is WHY the wave ended.
   */
  sendWaveResolved(wave: number, outcome: CoopWaveOutcome): void {
    this.transport.send({ t: "waveResolved", wave, outcome });
  }

  /**
   * OWNER (#633, TRACK-2 Phase C): stamp the owner's full-state checksum at a mystery-encounter
   * boundary so the watcher can verify its ME state is identical before the pump replays.
   */
  sendMeChecksum(seq: number, checksum: string): void {
    this.transport.send({ t: "meChecksum", seq, checksum });
  }

  /**
   * WATCHER (#633, TRACK-2 Phase C): subscribe to the owner's ME-boundary checksum. The handler
   * verifies it against the watcher's own + triggers a `stateSync` heal on a mismatch.
   */
  onMeChecksum(handler: (seq: number, checksum: string) => void): void {
    this.meChecksumHandler = handler;
  }

  /**
   * HOST: subscribe to the guest's resync requests. The handler receives the desynced
   * `turn` + the request `seq` it must echo on the `stateSync` reply (so the guest can
   * drop a stale answer). Returns immediately; the host builds + sends the blob.
   */
  onStateSyncRequest(handler: (turn: number, seq: number) => void): void {
    this.stateSyncRequestHandler = handler;
  }

  // --- GUEST side -------------------------------------------------------------

  /** GUEST: handle the host's enemy party (adopt it verbatim). */
  onEnemyPartySync(handler: (wave: number, enemies: CoopSerializedEnemy[]) => void): void {
    this.enemyPartyHandler = handler;
  }

  /**
   * GUEST: subscribe to the host's authoritative ghost pool (#633). If the pool already
   * arrived before this subscribe (the prefetch broadcast is early + one-shot), it is
   * delivered immediately so it is never missed.
   */
  onGhostPool(handler: (pool: GhostTeamSnapshot[]) => void): void {
    this.ghostPoolHandler = handler;
    if (this.lastGhostPool != null) {
      const pool = this.lastGhostPool;
      this.lastGhostPool = null;
      handler(pool);
    }
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

  /**
   * GUEST (#633, authoritative ME battle handoff): await the host's authoritative enemy party
   * for an ME-spawned battle keyed by `key` (`meBattleHandoffKey`). Resolves immediately with
   * the buffered party if the host already sent it, else waits for it, or resolves `null` on
   * timeout (the guest then keeps its locally-rolled party - divergent but never a hang). The
   * guest calls this at the ME battle handoff, BEFORE entering the battle, so it adopts the
   * host's boss verbatim. Mirrors {@linkcode awaitEnemyParty} exactly, keyed by string.
   */
  awaitMeBattleEnemyParty(key: string, timeoutMs = this.timeoutMs): Promise<CoopSerializedEnemy[] | null> {
    // Already buffered for this key (the host raced ahead) -> consume + return immediately.
    const buffered = this.meBattlePartyInbox.get(key);
    if (buffered !== undefined) {
      this.meBattlePartyInbox.delete(key);
      return Promise.resolve(buffered);
    }
    // Supersede any stale waiter for this key.
    this.meBattlePartyWaiters.get(key)?.(null);
    return new Promise<CoopSerializedEnemy[] | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopSerializedEnemy[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.meBattlePartyWaiters.get(key) === finish) {
          this.meBattlePartyWaiters.delete(key);
        }
        resolve(res);
      };
      this.meBattlePartyWaiters.set(key, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** GUEST: handle an out-of-turn authoritative checkpoint. */
  onCheckpoint(handler: (reason: string, checkpoint: CoopBattleCheckpoint) => void): void {
    this.checkpointHandler = handler;
  }

  /**
   * GUEST: subscribe to the host's wave-resolved signal (#633, authoritative wave-advance).
   * The handler runs the guest's normal post-battle tail so it reaches the next wave's
   * encounter (the pure renderer never queues that tail itself).
   */
  onWaveResolved(handler: (wave: number, outcome: CoopWaveOutcome) => void): void {
    this.waveResolvedHandler = handler;
  }

  /**
   * GUEST: take + clear the latest authoritative checkpoint (+ the host's checksum), if
   * any. The guest applies it at a SAFE turn boundary (start of its next command phase)
   * rather than mid-resolution, so a snap to the host's post-turn state can never fight a
   * running phase. The `checksum` lets the guest verify it converged after applying.
   */
  consumeCheckpoint(): CoopCheckpointEnvelope | null {
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

  /**
   * GUEST: request the host's authoritative full state after a checksum mismatch at
   * `turn`, then await the answering `stateSync` blob (#633, TRACK-2). Returns the
   * compressed blob to adopt, or `null` on timeout (the guest then keeps its current
   * state and re-checks next turn - degraded but never hung). One request is in flight
   * at a time: a new request supersedes any older waiter (resolves it null), so a
   * multi-turn divergence can't fan out into overlapping resyncs.
   */
  requestStateSync(turn: number): Promise<string | null> {
    // Supersede every older in-flight resync (the newest desync is the one to heal).
    for (const finish of [...this.stateSyncWaiters.values()]) {
      finish(null);
    }
    this.stateSyncWaiters.clear();
    const seq = ++this.stateSyncSeq;
    // The host may have already answered this exact seq (race) - consume it if so.
    const buffered = this.stateSyncInbox.get(seq);
    if (buffered !== undefined) {
      this.stateSyncInbox.delete(seq);
      this.transport.send({ t: "requestStateSync", turn, seq });
      return Promise.resolve(buffered);
    }
    return new Promise<string | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (blob: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.stateSyncWaiters.get(seq) === finish) {
          this.stateSyncWaiters.delete(seq);
        }
        resolve(blob);
      };
      this.stateSyncWaiters.set(seq, finish);
      cancelTimer = this.schedule(() => finish(null), this.timeoutMs);
      this.transport.send({ t: "requestStateSync", turn, seq });
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
    for (const finish of [...this.meBattlePartyWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.stateSyncWaiters.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.enemyPartyWaiters.clear();
    this.meBattlePartyWaiters.clear();
    this.meBattlePartyInbox.clear();
    this.stateSyncWaiters.clear();
    this.stateSyncInbox.clear();
    this.inbox.clear();
    this.lastCheckpoint = null;
    this.lastEnemyParty = null;
    this.enemyPartyHandler = null;
    this.checkpointHandler = null;
    this.ghostPoolHandler = null;
    this.lastGhostPool = null;
    this.stateSyncRequestHandler = null;
    this.meChecksumHandler = null;
    this.waveResolvedHandler = null;
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
      case "meBattleEnemyPartySync": {
        // Hand it straight to a parked awaitMeBattleEnemyParty (consumed), else buffer for the
        // next await (the host may race ahead of the guest reaching the handoff). Keyed by the
        // ME interaction so two ME battles in a wave never collide (#633 ME handoff).
        const waiter = this.meBattlePartyWaiters.get(msg.key);
        if (waiter) {
          waiter(msg.enemies);
          return;
        }
        this.meBattlePartyInbox.set(msg.key, msg.enemies);
        return;
      }
      case "turnResolution": {
        const res: CoopTurnResolution = {
          turn: msg.turn,
          events: msg.events,
          checkpoint: msg.checkpoint,
          checksum: msg.checksum,
          ...(msg.preimage === undefined ? {} : { preimage: msg.preimage }),
        };
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
        // Buffer for the guest's next consumeCheckpoint() (applied at a turn boundary),
        // carrying the host's checksum so the guest can verify convergence after applying.
        this.lastCheckpoint = { reason: msg.reason, checkpoint: msg.checkpoint, checksum: msg.checksum };
        this.checkpointHandler?.(msg.reason, msg.checkpoint);
        return;
      case "requestStateSync":
        // HOST: the guest detected a desync - hand the request to the host's builder.
        this.stateSyncRequestHandler?.(msg.turn, msg.seq);
        return;
      case "stateSync": {
        // GUEST: deliver to a parked awaiter for this seq, else buffer it (race).
        const waiter = this.stateSyncWaiters.get(msg.seq);
        if (waiter) {
          waiter(msg.blob);
        } else {
          this.stateSyncInbox.set(msg.seq, msg.blob);
        }
        return;
      }
      case "meChecksum":
        // WATCHER: the owner's ME-boundary checksum - verify + heal on mismatch.
        this.meChecksumHandler?.(msg.seq, msg.checksum);
        return;
      case "waveResolved":
        // GUEST: the host cleared/ended this wave - run the normal post-battle tail.
        this.waveResolvedHandler?.(msg.wave, msg.outcome);
        return;
      case "ghostPool":
        // Deliver to a live handler, else buffer (the broadcast can land before the
        // guest's runtime wiring subscribes - it's sent eagerly on prefetch-resolve).
        if (this.ghostPoolHandler == null) {
          this.lastGhostPool = msg.pool;
        } else {
          this.ghostPoolHandler(msg.pool);
        }
        return;
      default:
        // Not a stream message - ignored (other layers handle ping/command/etc.).
        return;
    }
  }
}

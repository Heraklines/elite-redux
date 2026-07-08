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

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopCapturePresentation,
  CoopFullMonSnapshot,
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
  /**
   * The host's COMPLETE per-mon on-field snapshot (#633 M2): heals the on-field state the numeric
   * `checkpoint` omits (moveset+PP / tera / boss / held items / ability / form) IN-LINE this turn.
   * Optional + additive; an older host omits it and the guest keeps checksum-detect + resync heal.
   */
  fullField?: CoopFullMonSnapshot[];
  /** Full normal-turn authoritative state, additive rollout. */
  authoritativeState?: CoopAuthoritativeBattleStateV1;
}

/** An out-of-turn authoritative checkpoint + the host's matching full-state checksum. */
export interface CoopCheckpointEnvelope {
  reason: string;
  checkpoint: CoopBattleCheckpoint;
  /** The host's full-state checksum at this boundary (#633, TRACK-2). */
  checksum: string;
  /** Full authoritative state for intra-turn boundaries such as replacement unblock. */
  authoritativeState?: CoopAuthoritativeBattleStateV1;
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

/**
 * #862: the host's wave-start enemyPartySync states an explicit NEGATIVE ME verdict with this
 * sentinel - "this wave has NO mystery encounter". Only the wave-start send (encounter-phase)
 * passes a verdict; mid-battle syncs stay silent so a battle-handoff sync can never record a
 * false no-ME for an ME wave.
 */
export const COOP_WAVE_NO_ME = -1;

/**
 * How many past turns of buffered LIVE battle events to retain (#633, animation layer). A handful is
 * plenty: a turn's events are consumed at that turn's boundary, so retention only needs to cover a
 * late event for the turn just before the one being rendered. Bounded so a long run never leaks memory.
 */
const LIVE_EVENT_TURN_RETENTION = 4;

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
  /** #806 stall watchdog: when each parked turn wait began (same keys as `pending`). */
  private readonly pendingSince = new Map<number, number>();
  /** turn -> a resolution that arrived before its waiter (race buffer). */
  private readonly inbox = new Map<number, CoopTurnResolution>();
  /**
   * GUEST: live battle events buffered by turn, keyed inner by `seq` so a duplicate / out-of-order
   * `battleEvent` is de-duped + a stutter (a missing seq) is tolerated (#633, animation layer LIVE).
   * Consumed in seq order by `CoopReplayTurnPhase` at the turn boundary, so the guest never replays a
   * live event twice (it de-dupes the turn-end batch against these). A bounded number of past turns is
   * retained ({@linkcode LIVE_EVENT_TURN_RETENTION}) so a late event for a just-finished turn is not
   * silently dropped while old turns never leak.
   */
  private readonly liveEvents = new Map<number, Map<number, CoopBattleEvent>>();
  /** GUEST: live-event arrival handler (optional; lets a live pump react the instant one lands). */
  private liveEventHandler: ((turn: number, seq: number, event: CoopBattleEvent) => void) | null = null;
  /** GUEST: one-shot live-arrival waiter for the pump race ({@linkcode awaitTurnOrLiveEvent}). */
  private liveWaiter: ((turn: number, seq: number) => void) | null = null;
  /** GUEST: one-shot OUT-OF-BAND-checkpoint waiter for the pump race (#633 guest-faint deadlock). */
  private checkpointWaiter: (() => void) | null = null;
  /**
   * GUEST (#790, the post-resync strand): the last (wave, turn) whose resolution was HANDED TO A
   * FINALIZE. A duplicate CoopReplayTurnPhase for an already-finalized turn (leftover pump
   * continuation racing a resync) must END instead of parking 20 minutes on a resolution the
   * host will never resend. Per-session by construction (a new session builds a new streamer).
   */
  private finalizedMark: { wave: number; turn: number } | null = null;

  markTurnFinalized(wave: number, turn: number): void {
    if (
      this.finalizedMark == null
      || wave > this.finalizedMark.wave
      || (wave === this.finalizedMark.wave && turn > this.finalizedMark.turn)
    ) {
      this.finalizedMark = { wave, turn };
    }
  }

  isTurnFinalized(wave: number, turn: number): boolean {
    return this.finalizedMark != null && this.finalizedMark.wave === wave && turn <= this.finalizedMark.turn;
  }

  /**
   * #790 REGRESSION FIX (live "after even normal combat we are stuck"): the guest's
   * currentBattle.waveIndex may not have ticked yet when the NEXT wave's first replay phase
   * starts, so a mark from the finished wave (same waveIndex, turn 1) wrongly killed the new
   * wave's turn 1 in a loop. Clear the mark the moment the guest processes a wave advance -
   * the mark only ever exists to kill duplicates WITHIN the wave it was set in.
   */
  clearFinalizedMark(): void {
    this.finalizedMark = null;
  }

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
  /** wave -> resolver for an in-flight {@linkcode awaitLaunchSnapshot} (#633 M4 push-snapshot launch). */
  private readonly launchSnapshotWaiters = new Map<number, (res: string | null) => void>();
  /** Latest launch snapshot that arrived before its waiter (race buffer, keyed by wave). */
  private lastLaunchSnapshot: { wave: number; session: string } | null = null;
  /** GUEST: handler for the host's authoritative ghost-team pool (#633 ghost-pool sync). */
  private ghostPoolHandler: ((pool: GhostTeamSnapshot[]) => void) | null = null;
  /** GUEST: the host's ghost pool that arrived before a handler subscribed (delivered on subscribe). */
  private lastGhostPool: GhostTeamSnapshot[] | null = null;
  /** HOST: handler answering the guest's `requestStateSync` (#633, TRACK-2 resync). */
  private stateSyncRequestHandler: ((turn: number, seq: number) => void) | null = null;
  /** HOST: handler answering the guest's `requestEnemyParty` re-request (#633/#698 handoff robustness). */
  private enemyPartyRequestHandler: ((wave: number) => void) | null = null;
  /** GUEST: seq -> resolver for an in-flight {@linkcode awaitStateSync}. */
  private readonly stateSyncWaiters = new Map<number, (blob: string | null) => void>();
  /** GUEST: a `stateSync` blob that arrived before its waiter (race buffer), keyed by seq. */
  private readonly stateSyncInbox = new Map<number, string>();
  /** GUEST: monotonic resync request counter (each desync request bumps it). */
  private stateSyncSeq = 0;
  /** WATCHER: handler for the owner's ME-boundary checksum (#633, TRACK-2 Phase C). */
  private meChecksumHandler: ((seq: number, checksum: string) => void) | null = null;
  /** GUEST: handler for the host's ME narration lines (#633, TRACK-2 Phase C, non-battle ME). */
  private meMessageHandler: ((text: string) => void) | null = null;
  /** GUEST: handler for the host's wave-resolved signal (#633, authoritative wave-advance). */
  private waveResolvedHandler:
    | ((
        wave: number,
        outcome: CoopWaveOutcome,
        captureParty?: string[],
        capturePresentation?: CoopCapturePresentation,
      ) => void)
    | null = null;
  /** GUEST: handler for the host's WAVE-END authoritative full-state snapshot (#838). */
  private waveEndStateHandler: ((wave: number, state: CoopAuthoritativeBattleStateV1) => void) | null = null;

  /** GUEST (#825): the host's rolled ME type per wave (from enemyPartySync). */
  private readonly meTypeByWave = new Map<number, number>();

  /**
   * GUEST (#825/#862): the host's ME verdict for `wave`, if its wave-start sync arrived.
   * `>= 0` = the host rolled THIS MysteryEncounterType; {@linkcode COOP_WAVE_NO_ME} = the
   * host explicitly rolled NO ME (#862: the guest's own presence roll depends on per-client
   * pity state that diverges after any one-sided ME anomaly - same seed, different verdict -
   * so the guest must adopt the host's verdict in BOTH directions); `undefined` = no
   * wave-start sync received yet (fall back to the local roll; the MysteryEncounterPhase
   * divert guard catches a late-arriving negative verdict).
   */
  meTypeForWave(wave: number): number | undefined {
    return this.meTypeByWave.get(wave);
  }

  constructor(transport: CoopTransport, opts: CoopBattleStreamerOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    coopLog("stream", `streamer CONSTRUCT timeout=${this.timeoutMs}ms onMessage registered`);
  }

  // --- HOST side --------------------------------------------------------------

  /** HOST: send the exact enemy party the guest must adopt verbatim for `wave`. */
  sendEnemyParty(wave: number, enemies: CoopSerializedEnemy[], meType?: number): void {
    coopLog("replay", `host SEND enemyPartySync wave=${wave} count=${enemies.length} meType=${meType ?? "-"}`);
    this.transport.send({ t: "enemyPartySync", wave, enemies, ...(meType === undefined ? {} : { meType }) });
  }

  /**
   * HOST (#633 M4 push-snapshot launch): PUSH the authoritative full session snapshot for `wave`
   * the instant the host's session is coherent (its EncounterPhase). `session` is a JSON-serialized
   * {@linkcode SessionSaveData} (`getSessionSaveData()`). The guest BOOTS from it - rolling no enemy /
   * arena / party of its own - so it can never diverge at launch (§3.6). Replaces the narrow
   * `enemyPartySync` + the `requestEnemyParty` poll for the launch (and every hard-transition) boundary.
   */
  sendLaunchSnapshot(wave: number, session: string): void {
    coopLog("replay", `host SEND launchSnapshot wave=${wave} sessionLen=${session.length}`);
    this.transport.send({ t: "launchSnapshot", wave, session });
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
    coopLog("replay", `host SEND meBattleEnemyPartySync key=${key} count=${enemies.length}`);
    this.transport.send({ t: "meBattleEnemyPartySync", key, enemies });
  }

  /**
   * HOST: broadcast the authoritative ghost-team pool (#633). Ghost teams are fetched
   * per-client from the shared server pool, so the two clients otherwise field divergent
   * ghosts. The guest adopts this pool verbatim (and skips its own fetch), making
   * `takeGhostForWave`'s seeded pick deterministic on both. Sent once on prefetch-resolve.
   */
  sendGhostPool(pool: GhostTeamSnapshot[]): void {
    coopLog("replay", `host SEND ghostPool count=${pool.length}`);
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
    fullField?: CoopFullMonSnapshot[],
    authoritativeState?: CoopAuthoritativeBattleStateV1,
  ): void {
    coopLog(
      "replay",
      `host SEND turnResolution turn=${turn} events=${events.length} checksum=${checksum} preimage=${preimage !== undefined} fullField=${fullField?.length ?? 0} authoritativeState=${authoritativeState === undefined ? 0 : 1}`,
    );
    this.transport.send({
      t: "turnResolution",
      turn,
      events,
      checkpoint,
      checksum,
      ...(preimage === undefined ? {} : { preimage }),
      ...(fullField === undefined ? {} : { fullField }),
      ...(authoritativeState === undefined ? {} : { authoritativeState }),
    });
  }

  /**
   * HOST: emit ONE visible battle event LIVE (#633, animation layer), the instant the host records
   * it, so the guest can WATCH the fight unfold with minimal lag instead of waiting for the whole
   * turn to batch at turn-end. `seq` is a per-turn monotonic index the host supplies (so the guest
   * replays in order + de-dupes against the turn-end batch). PRESENTATION ONLY - the turn-end
   * checkpoint is still the source of truth, so a dropped / reordered live event only stutters.
   */
  emitEvent(turn: number, seq: number, event: CoopBattleEvent): void {
    // HOT PATH (per battle event): build the trace string only when debug is on.
    if (isCoopDebug()) {
      coopLog("replay", `host EMIT live battleEvent turn=${turn} seq=${seq} k=${event.k}`);
    }
    this.transport.send({ t: "battleEvent", turn, seq, event });
  }

  /**
   * HOST: send an out-of-turn authoritative checkpoint (after a switch / capture / resume),
   * stamped with the host's full-state `checksum` for the guest to verify (#633, TRACK-2).
   */
  sendCheckpoint(
    reason: string,
    checkpoint: CoopBattleCheckpoint,
    checksum: string,
    authoritativeState?: CoopAuthoritativeBattleStateV1,
  ): void {
    coopLog(
      "checksum",
      `host SEND battleCheckpoint reason=${reason} checksum=${checksum} authoritativeState=${authoritativeState === undefined ? 0 : 1}`,
    );
    this.transport.send({
      t: "battleCheckpoint",
      reason,
      checkpoint,
      checksum,
      ...(authoritativeState === undefined ? {} : { authoritativeState }),
    });
  }

  /** HOST: send the authoritative full-state snapshot answering a guest's `requestStateSync`. */
  sendStateSync(blob: string, seq: number): void {
    coopLog("resync", `host SEND stateSync seq=${seq} blobLen=${blob.length}`);
    this.transport.send({ t: "stateSync", blob, seq });
  }

  /**
   * HOST: signal that the host RESOLVED the `wave`'s battle end (#633, authoritative
   * wave-advance handshake). The guest - a pure renderer that removes KOd enemies without a
   * FaintPhase - uses this to run the normal post-battle tail and reach the next wave (it
   * would otherwise loop the won wave forever). `outcome` is WHY the wave ended.
   */
  sendWaveResolved(
    wave: number,
    outcome: CoopWaveOutcome,
    captureParty?: string[],
    capturePresentation?: CoopCapturePresentation,
  ): void {
    coopLog(
      "replay",
      `host SEND waveResolved wave=${wave} outcome=${outcome}${captureParty == null ? "" : ` captureParty=${captureParty.length}`}${capturePresentation == null ? "" : ` cap=sp${capturePresentation.speciesId}`}`,
    );
    this.transport.send({ t: "waveResolved", wave, outcome, captureParty, capturePresentation });
  }

  /**
   * HOST (#838 WAVE-END authoritative capture): stream the COMPLETE post-exp authoritative battle
   * state for `wave`, captured in the host's `BattleEndPhase` AFTER the wave's exp/level/evolution
   * chain drained. The guest adopts it via a single id-based full-state apply, so its levels / exp /
   * learned moves / evolved species converge through the between-wave shop off the same wire the live
   * turns use. This is the sole post-battle progression channel (the legacy per-slot exp-delta relay
   * it superseded has been removed).
   */
  sendWaveEndState(wave: number, state: CoopAuthoritativeBattleStateV1): void {
    coopLog("replay", `host SEND waveEndState wave=${wave} tick=${state.tick} party=${state.playerParty.length}`);
    this.transport.send({ t: "waveEndState", wave, state });
  }

  /**
   * GUEST (#838): subscribe to the host's WAVE-END authoritative full-state snapshot. The handler
   * stores a one-shot pending payload the guest's `BattleEndPhase` consumes + applies (id-based
   * full-state apply). Wave-guarded by the caller.
   */
  onWaveEndState(handler: (wave: number, state: CoopAuthoritativeBattleStateV1) => void): void {
    coopLog("stream", `guest REGISTER onWaveEndState handler (was=${this.waveEndStateHandler != null})`);
    this.waveEndStateHandler = handler;
  }

  /**
   * OWNER (#633, TRACK-2 Phase C): stamp the owner's full-state checksum at a mystery-encounter
   * boundary so the watcher can verify its ME state is identical before the pump replays.
   */
  sendMeChecksum(seq: number, checksum: string): void {
    coopLog("checksum", `owner SEND meChecksum seq=${seq} checksum=${checksum}`);
    this.transport.send({ t: "meChecksum", seq, checksum });
  }

  /**
   * WATCHER (#633, TRACK-2 Phase C): subscribe to the owner's ME-boundary checksum. The handler
   * verifies it against the watcher's own + triggers a `stateSync` heal on a mismatch.
   */
  onMeChecksum(handler: (seq: number, checksum: string) => void): void {
    coopLog("stream", `watcher REGISTER onMeChecksum handler (was=${this.meChecksumHandler != null})`);
    this.meChecksumHandler = handler;
  }

  /**
   * HOST (#633, TRACK-2 Phase C, non-battle ME narration): stream one ME dialogue/text line to the
   * guest's CoopReplayMePhase so its screen matches the host-run encounter. Cosmetic - the outcome
   * rides the reward alternation + the full-state snapshot, so a dropped line never desyncs.
   */
  sendMeMessage(text: string): void {
    if (isCoopDebug()) {
      coopLog("replay", `host SEND meMessage len=${text.length}`);
    }
    this.transport.send({ t: "meMessage", text });
  }

  /**
   * GUEST (#633, TRACK-2 Phase C, non-battle ME narration): subscribe to the host's ME narration
   * lines. The handler queues each one (verbatim, already localized by the host) so the diverted
   * guest's encounter screen renders the same text the host's authoritative ME engine produced.
   * Returns an unsubscribe function (CoopReplayMePhase drops it when the encounter terminal fires).
   */
  onMeMessage(handler: (text: string) => void): () => void {
    coopLog("stream", `guest REGISTER onMeMessage handler (was=${this.meMessageHandler != null})`);
    this.meMessageHandler = handler;
    return () => {
      if (this.meMessageHandler === handler) {
        coopLog("stream", "guest UNREGISTER onMeMessage handler (null-out)");
        this.meMessageHandler = null;
      }
    };
  }

  /**
   * HOST: subscribe to the guest's resync requests. The handler receives the desynced
   * `turn` + the request `seq` it must echo on the `stateSync` reply (so the guest can
   * drop a stale answer). Returns immediately; the host builds + sends the blob.
   */
  onStateSyncRequest(handler: (turn: number, seq: number) => void): void {
    coopLog("stream", `host REGISTER onStateSyncRequest handler (was=${this.stateSyncRequestHandler != null})`);
    this.stateSyncRequestHandler = handler;
  }

  /**
   * HOST (#633/#698, enemy-party handoff robustness): subscribe to the guest's
   * `requestEnemyParty` re-request. The handler re-broadcasts the host's enemy party for
   * `wave` IF the host has already generated it (else it is a harmless no-op - the host
   * has not reached its broadcast yet, and the eventual one-shot broadcast still lands on
   * the guest's parked waiter). Lets a guest whose original `enemyPartySync` was lost (or
   * who reached its await before the host generated) pull the party on demand instead of
   * hard-blocking the 120s ceiling.
   */
  onEnemyPartyRequest(handler: (wave: number) => void): void {
    coopLog("stream", `host REGISTER onEnemyPartyRequest handler (was=${this.enemyPartyRequestHandler != null})`);
    this.enemyPartyRequestHandler = handler;
  }

  // --- GUEST side -------------------------------------------------------------

  /**
   * GUEST (#633/#698, enemy-party handoff robustness): ask the host to (re)send the enemy
   * party for `wave`. Paired with {@linkcode awaitEnemyPartyWithRetry}'s retry loop - a
   * harmless no-op on the host before it has generated the party, self-healing once it has.
   */
  requestEnemyParty(wave: number): void {
    coopLog("stream", `guest SEND requestEnemyParty wave=${wave}`);
    this.transport.send({ t: "requestEnemyParty", wave });
  }

  /** GUEST: handle the host's enemy party (adopt it verbatim). */
  onEnemyPartySync(handler: (wave: number, enemies: CoopSerializedEnemy[]) => void): void {
    coopLog("stream", `guest REGISTER onEnemyPartySync handler (was=${this.enemyPartyHandler != null})`);
    this.enemyPartyHandler = handler;
  }

  /**
   * GUEST: subscribe to the host's authoritative ghost pool (#633). If the pool already
   * arrived before this subscribe (the prefetch broadcast is early + one-shot), it is
   * delivered immediately so it is never missed.
   */
  onGhostPool(handler: (pool: GhostTeamSnapshot[]) => void): void {
    coopLog("stream", `guest REGISTER onGhostPool handler (bufferedEarly=${this.lastGhostPool != null})`);
    this.ghostPoolHandler = handler;
    if (this.lastGhostPool != null) {
      const pool = this.lastGhostPool;
      this.lastGhostPool = null;
      coopLog("stream", `guest onGhostPool: delivering buffered-early pool count=${pool.length}`);
      handler(pool);
    }
  }

  /**
   * GUEST: take + clear the latest enemy party the host streamed for `wave`, if any.
   * Returns null when none is buffered or it is for a different wave (so the guest
   * never adopts a stale wave's enemies). Applied at the wave's first turn boundary.
   */
  /**
   * #806 stall watchdog (standard keepalive/deadlock-detection support): age (ms) of the OLDEST
   * parked turn wait, or -1 when none. Mirrors the relay's reader; the watchdog reports the max.
   */
  oldestNetworkWaitMs(): number {
    let oldest = -1;
    const now = Date.now();
    for (const since of this.pendingSince.values()) {
      const age = now - since;
      if (age > oldest) {
        oldest = age;
      }
    }
    return oldest;
  }

  /** #819: consume a buffered ME-spawned-battle party by its exact handoff key. */
  consumeMeBattleEnemyParty(key: string): CoopSerializedEnemy[] | null {
    const enemies = this.meBattlePartyInbox.get(key);
    if (enemies == null) {
      return null;
    }
    this.meBattlePartyInbox.delete(key);
    coopLog("stream", `guest consumeMeBattleEnemyParty ${key} -> ${enemies.length} enemies`);
    return enemies;
  }

  consumeEnemyParty(wave: number): CoopSerializedEnemy[] | null {
    const buffered = this.lastEnemyParty;
    if (buffered == null || buffered.wave !== wave) {
      // #693 ME battle desync: the ME handoff streams enemies keyed `me:<wave>:<counter>`;
      // the guest's encounter build consumes by WAVE and missed them (live: "consumeEnemyParty
      // wave=3 -> null" while `me:3:2` sat buffered -> guest generated DIFFERENT enemies).
      // Fall back to a buffered ME party for THIS wave.
      for (const [key, enemies] of this.meBattlePartyInbox) {
        if (key.startsWith(`me:${wave}:`)) {
          this.meBattlePartyInbox.delete(key);
          coopLog("stream", `guest consumeEnemyParty wave=${wave} -> ${enemies.length} enemies (ME buffer ${key})`);
          return enemies;
        }
      }
      if (isCoopDebug()) {
        coopLog(
          "stream",
          `guest consumeEnemyParty wave=${wave} -> null (buffered=${buffered == null ? "none" : `wave ${buffered.wave}`})`,
        );
      }
      return null;
    }
    this.lastEnemyParty = null;
    coopLog("stream", `guest consumeEnemyParty wave=${wave} -> ${buffered.enemies.length} enemies`);
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
      coopLog("stream", `guest awaitEnemyParty wave=${wave} RESOLVE (buffered race) count=${buffered.length}`);
      return Promise.resolve(buffered);
    }
    // Supersede any stale waiter for this wave.
    const stale = this.enemyPartyWaiters.get(wave);
    if (stale != null) {
      coopWarn("stream", `guest awaitEnemyParty wave=${wave} superseding stale waiter`);
      stale(null);
    }
    coopLog("stream", `guest awaitEnemyParty wave=${wave} START timeout=${timeoutMs}ms`);
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
        if (res == null) {
          coopWarn(
            "stream",
            `guest awaitEnemyParty wave=${wave} -> null (timeout/superseded), guest will self-generate enemies`,
          );
        } else {
          coopLog("stream", `guest awaitEnemyParty wave=${wave} RESOLVE count=${res.length}`);
        }
        resolve(res);
      };
      this.enemyPartyWaiters.set(wave, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /**
   * GUEST (#633 M4 push-snapshot launch): await the host's authoritative full session snapshot
   * for `wave`. Resolves immediately with the buffered snapshot if the host raced ahead, else
   * waits for the host's PUSH (event-driven - NO re-request poll; the ordered/reliable channel
   * guarantees delivery), or resolves `null` on timeout (the caller then falls back to its own
   * launch so it can never hard-hang). Mirrors {@linkcode awaitEnemyParty} exactly. The guest calls
   * this at launch BEFORE building anything, then boots from the snapshot (computing nothing).
   */
  awaitLaunchSnapshot(wave: number, timeoutMs = this.timeoutMs): Promise<string | null> {
    // Already buffered for this wave (the host raced ahead) -> consume + return immediately.
    const buffered = this.lastLaunchSnapshot;
    if (buffered != null && buffered.wave === wave) {
      this.lastLaunchSnapshot = null;
      coopLog(
        "stream",
        `guest awaitLaunchSnapshot wave=${wave} RESOLVE (buffered race) len=${buffered.session.length}`,
      );
      return Promise.resolve(buffered.session);
    }
    // Supersede any stale waiter for this wave.
    const stale = this.launchSnapshotWaiters.get(wave);
    if (stale != null) {
      coopWarn("stream", `guest awaitLaunchSnapshot wave=${wave} superseding stale waiter`);
      stale(null);
    }
    coopLog("stream", `guest awaitLaunchSnapshot wave=${wave} START timeout=${timeoutMs}ms`);
    return new Promise<string | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.launchSnapshotWaiters.get(wave) === finish) {
          this.launchSnapshotWaiters.delete(wave);
        }
        if (res == null) {
          coopWarn(
            "stream",
            `guest awaitLaunchSnapshot wave=${wave} -> null (timeout/superseded), guest falls back to its own launch`,
          );
        } else {
          coopLog("stream", `guest awaitLaunchSnapshot wave=${wave} RESOLVE len=${res.length}`);
        }
        resolve(res);
      };
      this.launchSnapshotWaiters.set(wave, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /**
   * GUEST (#633/#698, enemy-party handoff robustness): await the host's enemy party for
   * `wave` WITH a bounded re-request retry, so a single LOST `enemyPartySync` (or a host that
   * has not broadcast yet) never silently hard-locks the guest for the full 120s ceiling.
   *
   * Behaviour: the underlying {@linkcode awaitEnemyParty} runs for the FULL `timeoutMs` ceiling
   * (the backstop - unchanged). On TOP of it, every `retryIntervalMs` (up to `maxRetries` times)
   * the guest re-requests the party via `sendRequest` (the host re-broadcasts if it has it),
   * emitting a `coopWarn` each attempt so a future capture shows the retry path. The first
   * re-arrival - from the original broadcast, a retry response, or a pre-await buffered party -
   * resolves immediately; only the full ceiling with no arrival resolves null (then the caller
   * self-generates, exactly as before). A pre-await arrival is already BUFFERED by wave
   * (`lastEnemyParty` / the parked-waiter path), so it is consumed here, never lost.
   *
   * Engine-free + timer-injected like {@linkcode awaitEnemyParty}, so it is unit-testable; the
   * caller (the guest's EncounterPhase) supplies `sendRequest` (-> {@linkcode requestEnemyParty}).
   */
  awaitEnemyPartyWithRetry(
    wave: number,
    sendRequest: (wave: number) => void,
    opts: { timeoutMs?: number; retryIntervalMs?: number; maxRetries?: number } = {},
  ): Promise<CoopSerializedEnemy[] | null> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const retryIntervalMs = opts.retryIntervalMs ?? 5_000;
    const maxRetries = opts.maxRetries ?? 6;

    // The single long-lived await is the source of truth + the 120s backstop. We never
    // supersede it on a retry (that would resolve it null); we only re-poke the host.
    const awaited = this.awaitEnemyParty(wave, timeoutMs);
    if (maxRetries <= 0 || retryIntervalMs <= 0) {
      return awaited;
    }

    return new Promise<CoopSerializedEnemy[] | null>(resolve => {
      let settled = false;
      let attempts = 0;
      let cancelRetry: () => void = () => {};
      const stop = () => {
        cancelRetry();
        cancelRetry = () => {};
      };
      const scheduleNext = () => {
        cancelRetry = this.schedule(() => {
          if (settled) {
            return;
          }
          attempts++;
          coopWarn(
            "stream",
            `guest awaitEnemyPartyWithRetry wave=${wave} no party yet, RE-REQUEST attempt ${attempts}/${maxRetries}`,
          );
          try {
            sendRequest(wave);
          } catch {
            /* a re-request send failure must never break the guest's encounter */
          }
          if (attempts < maxRetries) {
            scheduleNext();
          }
        }, retryIntervalMs);
      };
      scheduleNext();
      void awaited.then(res => {
        if (settled) {
          return;
        }
        settled = true;
        stop();
        resolve(res);
      });
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
      coopLog("stream", `guest awaitMeBattleEnemyParty key=${key} RESOLVE (buffered race) count=${buffered.length}`);
      return Promise.resolve(buffered);
    }
    // Supersede any stale waiter for this key.
    const stale = this.meBattlePartyWaiters.get(key);
    if (stale != null) {
      coopWarn("stream", `guest awaitMeBattleEnemyParty key=${key} superseding stale waiter`);
      stale(null);
    }
    coopLog("stream", `guest awaitMeBattleEnemyParty key=${key} START timeout=${timeoutMs}ms`);
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
        if (res == null) {
          coopWarn(
            "stream",
            `guest awaitMeBattleEnemyParty key=${key} -> null (timeout/superseded), guest keeps locally-rolled party`,
          );
        } else {
          coopLog("stream", `guest awaitMeBattleEnemyParty key=${key} RESOLVE count=${res.length}`);
        }
        resolve(res);
      };
      this.meBattlePartyWaiters.set(key, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** GUEST: handle an out-of-turn authoritative checkpoint. */
  onCheckpoint(handler: (reason: string, checkpoint: CoopBattleCheckpoint) => void): void {
    coopLog("stream", `guest REGISTER onCheckpoint handler (was=${this.checkpointHandler != null})`);
    this.checkpointHandler = handler;
  }

  /**
   * GUEST: subscribe to the host's wave-resolved signal (#633, authoritative wave-advance).
   * The handler runs the guest's normal post-battle tail so it reaches the next wave's
   * encounter (the pure renderer never queues that tail itself).
   */
  onWaveResolved(
    handler: (
      wave: number,
      outcome: CoopWaveOutcome,
      captureParty?: string[],
      capturePresentation?: CoopCapturePresentation,
    ) => void,
  ): void {
    coopLog("stream", `guest REGISTER onWaveResolved handler (was=${this.waveResolvedHandler != null})`);
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
   * GUEST: subscribe to LIVE battle events as they arrive (#633, animation layer). The handler fires
   * the instant a `battleEvent` lands (already de-duped + buffered by `(turn, seq)`), so a live pump
   * can render it with minimal lag. Optional: with no handler the events are still buffered and
   * consumed at the turn boundary by {@linkcode consumeLiveEvents}. Returns an unsubscribe function.
   */
  onLiveEvent(handler: (turn: number, seq: number, event: CoopBattleEvent) => void): () => void {
    coopLog("stream", `guest REGISTER onLiveEvent handler (was=${this.liveEventHandler != null})`);
    this.liveEventHandler = handler;
    return () => {
      if (this.liveEventHandler === handler) {
        coopLog("stream", "guest UNREGISTER onLiveEvent handler (null-out)");
        this.liveEventHandler = null;
      }
    };
  }

  /**
   * GUEST: take + clear the LIVE battle events buffered for `turn`, in ascending `seq` order (#633,
   * animation layer). Returns the ordered events the guest already received over the live channel for
   * this turn (empty when none arrived live - e.g. an older host that never streams them, or all live
   * events dropped). The caller plays these and DE-DUPES the turn-end `turnResolution` batch against
   * the seqs returned, so no event is ever rendered twice. Clearing also prunes turns older than the
   * retention window so a long run never leaks.
   */
  consumeLiveEvents(turn: number): { seq: number; event: CoopBattleEvent }[] {
    const perTurn = this.liveEvents.get(turn);
    this.liveEvents.delete(turn);
    // Prune stale turns (anything well before the one being consumed) so the buffer stays bounded.
    for (const t of [...this.liveEvents.keys()]) {
      if (t < turn - LIVE_EVENT_TURN_RETENTION) {
        this.liveEvents.delete(t);
      }
    }
    if (perTurn == null) {
      coopLog("replay", `guest consume live events turn=${turn} count=0`);
      return [];
    }
    const consumed = [...perTurn.entries()].sort((a, b) => a[0] - b[0]).map(([seq, event]) => ({ seq, event }));
    coopLog("replay", `guest consume live events turn=${turn} count=${consumed.length}`);
    return consumed;
  }

  /**
   * GUEST live pump (#782, instant streaming): take + clear the CONTIGUOUS run of live events for
   * `turn` starting exactly at `fromSeq` (fromSeq, fromSeq+1, ... until the first gap). Ordering is
   * sacred - an event can only present after every earlier seq has - so a gap (a still-in-flight
   * earlier event) stops the drain; the gapped events stay buffered for a later call or the final
   * turn-end merge. Returns the ordered contiguous events (empty when seq `fromSeq` has not arrived).
   */
  consumeLiveEventsFrom(turn: number, fromSeq: number): CoopBattleEvent[] {
    const perTurn = this.liveEvents.get(turn);
    if (perTurn == null) {
      return [];
    }
    const run: CoopBattleEvent[] = [];
    for (let seq = fromSeq; ; seq++) {
      const event = perTurn.get(seq);
      if (event === undefined) {
        break;
      }
      run.push(event);
      perTurn.delete(seq);
    }
    if (run.length > 0 && isCoopDebug()) {
      coopLog("replay", `guest live-pump drain turn=${turn} seq=${fromSeq}..${fromSeq + run.length - 1}`);
    }
    return run;
  }

  /**
   * GUEST live pump (#782, instant streaming): await EITHER the host's `turnResolution` for `turn`
   * OR the next live `battleEvent` for it landing at-or-beyond `fromSeq` - whichever first. This is
   * what lets {@linkcode CoopReplayTurnPhase} present the host's events the moment they arrive
   * instead of batching the whole turn ("animations only after the host clicked through everything").
   *
   * Resolution semantics: `{kind:"live"}` = one or more new live events are buffered (drain them via
   * {@linkcode consumeLiveEventsFrom}); `{kind:"turn", res}` = the resolution arrived (res null on a
   * genuine host stall). CRITICAL rebuffer rule: when the LIVE leg wins the race and the resolution
   * lands on the now-stale turn waiter afterwards, it is put BACK into the inbox so the pump's next
   * race finds it - a raced-out resolution is never lost (that would stall the guest a full timeout).
   */
  awaitTurnOrLiveEvent(
    turn: number,
    fromSeq: number,
  ): Promise<{ kind: "turn"; res: CoopTurnResolution | null } | { kind: "live" } | { kind: "checkpoint" }> {
    // Fast paths: anything already buffered resolves without parking waiters. The OUT-OF-BAND
    // checkpoint is checked FIRST (#788): it is always NEWER state than a buffered turn
    // resolution (e.g. the post-faint replacement summon captured AFTER the turn ended), and
    // its slot entries are ALIVE - applying it triggers the visual summon reposition the
    // turn-end checkpoint (slot still fainted) skips. Live failure this fixes: the resolution
    // beat the replacement snapshot into the buffer and the chooser never saw their mon
    // come out on screen.
    if (this.lastCheckpoint != null) {
      return Promise.resolve({ kind: "checkpoint" as const });
    }
    if (this.inbox.has(turn)) {
      return this.awaitTurn(turn).then(res => ({ kind: "turn" as const, res }));
    }
    const perTurn = this.liveEvents.get(turn);
    if (perTurn != null && perTurn.has(fromSeq)) {
      return Promise.resolve({ kind: "live" as const });
    }
    return new Promise(resolve => {
      let settled = false;
      const cleanup = () => {
        if (this.liveWaiter === settleLive) {
          this.liveWaiter = null;
          this.checkpointWaiter = null;
        }
        if (this.checkpointWaiter === settleCheckpoint) {
          this.checkpointWaiter = null;
        }
      };
      const settleLive = (liveTurn: number, seq: number) => {
        if (settled || liveTurn !== turn || seq < fromSeq) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ kind: "live" });
      };
      // #633 guest-faint deadlock: an OUT-OF-BAND checkpoint (the host auto-summoned a
      // replacement into the guest-owned slot) must WAKE the parked pump - it carries the
      // mon the guest has to command before the turn resolution can ever arrive.
      const settleCheckpoint = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ kind: "checkpoint" });
      };
      this.liveWaiter = settleLive;
      this.checkpointWaiter = settleCheckpoint;
      void this.awaitTurn(turn).then(res => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ kind: "turn", res });
          return;
        }
        // The live/checkpoint leg already won this race; a resolution landing on the stale
        // waiter must be REBUFFERED so the pump's next race consumes it (never lost).
        if (res != null) {
          coopLog("replay", `guest live-pump rebuffer turnResolution turn=${turn} (raced out)`);
          this.inbox.set(turn, res);
        }
      });
    });
  }

  /**
   * GUEST: await the host's resolution for `turn`. Resolves with the streamed turn,
   * or `null` if it does not arrive within the timeout (the guest then shows a
   * "waiting for host" notice and applies the next checkpoint when it lands). If the
   * host already sent it (race), the buffered resolution returns immediately.
   */
  /**
   * #859: resolve a PARKED turn wait immediately (null) so an aborted PHANTOM replay phase - a
   * non-battle ME's leftover turn, see CoopReplayTurnPhase.abortPhantom - dissolves instead of
   * sleeping the full timeout. The caller sets its own aborted flag BEFORE calling this, so the
   * null resolution is interpreted as "aborted", never as a host stall.
   */
  abortTurnWait(turn: number): boolean {
    const pending = this.pending.get(turn);
    if (pending == null) {
      return false;
    }
    coopWarn("replay", `guest awaitTurn turn=${turn} ABORT (phantom turn dissolve #859)`);
    pending(null);
    return true;
  }

  awaitTurn(turn: number): Promise<CoopTurnResolution | null> {
    // Supersede any stale waiter for this turn.
    const staleTurn = this.pending.get(turn);
    if (staleTurn != null) {
      coopWarn("stream", `guest awaitTurn turn=${turn} superseding stale waiter`);
      staleTurn(null);
    }
    const buffered = this.inbox.get(turn);
    if (buffered !== undefined) {
      this.inbox.delete(turn);
      coopLog("replay", `guest awaitTurn turn=${turn} RESOLVE (buffered race) events=${buffered.events.length}`);
      return Promise.resolve(buffered);
    }
    coopLog("replay", `guest awaitTurn turn=${turn} START timeout=${this.timeoutMs}ms`);
    this.pendingSince.set(turn, Date.now());
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
          this.pendingSince.delete(turn);
        }
        if (res == null) {
          coopWarn("replay", `guest awaitTurn turn=${turn} STALL -> null (timeout/superseded)`);
        } else {
          coopLog(
            "replay",
            `guest awaitTurn turn=${turn} RESOLVE events=${res.events.length} checksum=${res.checksum}`,
          );
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
    const inFlight = this.stateSyncWaiters.size;
    if (inFlight > 0) {
      coopWarn("resync", `guest requestStateSync turn=${turn} superseding ${inFlight} older in-flight resync(s)`);
    }
    for (const finish of [...this.stateSyncWaiters.values()]) {
      finish(null);
    }
    this.stateSyncWaiters.clear();
    const seq = ++this.stateSyncSeq;
    // The host may have already answered this exact seq (race) - consume it if so.
    const buffered = this.stateSyncInbox.get(seq);
    if (buffered !== undefined) {
      this.stateSyncInbox.delete(seq);
      coopLog(
        "resync",
        `guest requestStateSync turn=${turn} seq=${seq} RESOLVE (buffered race) blobLen=${buffered.length}`,
      );
      this.transport.send({ t: "requestStateSync", turn, seq });
      return Promise.resolve(buffered);
    }
    coopLog("resync", `guest requestStateSync turn=${turn} seq=${seq} START timeout=${this.timeoutMs}ms`);
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
        if (blob == null) {
          coopWarn("resync", `guest requestStateSync turn=${turn} seq=${seq} -> null (timeout/superseded)`);
        } else {
          coopLog("resync", `guest requestStateSync turn=${turn} seq=${seq} RESOLVE blobLen=${blob.length}`);
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
    coopLog(
      "stream",
      `streamer DISPOSE: cancel pending(turns=${this.pending.size} enemyParty=${this.enemyPartyWaiters.size}`
        + ` meBattle=${this.meBattlePartyWaiters.size} stateSync=${this.stateSyncWaiters.size}) + null-out all handlers`,
    );
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
    this.liveEvents.clear();
    this.liveEventHandler = null;
    this.liveWaiter = null;
    this.lastCheckpoint = null;
    this.lastEnemyParty = null;
    this.enemyPartyHandler = null;
    this.checkpointHandler = null;
    this.ghostPoolHandler = null;
    this.lastGhostPool = null;
    this.stateSyncRequestHandler = null;
    this.enemyPartyRequestHandler = null;
    this.meChecksumHandler = null;
    this.meMessageHandler = null;
    this.waveResolvedHandler = null;
    this.waveEndStateHandler = null;
  }

  private handle(msg: CoopMessage): void {
    switch (msg.t) {
      case "enemyPartySync": {
        // #825: remember the host's rolled ME type for this wave so a guest that
        // generates its encounter AFTER the sync arrives adopts the host's roll.
        if (msg.meType !== undefined) {
          this.meTypeByWave.set(msg.wave, msg.meType);
        }
        // Hand it straight to a parked awaitEnemyParty (consumed), else buffer for the
        // next consume/await. Either way fire any live handler.
        const waiter = this.enemyPartyWaiters.get(msg.wave);
        coopLog(
          "replay",
          `guest RECV enemyPartySync wave=${msg.wave} count=${msg.enemies.length} ${waiter ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
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
      case "launchSnapshot": {
        // GUEST: hand the authoritative launch snapshot to a parked awaitLaunchSnapshot (consumed),
        // else buffer it for the next await (the host may race ahead of the guest reaching its await).
        const waiter = this.launchSnapshotWaiters.get(msg.wave);
        coopLog(
          "replay",
          `guest RECV launchSnapshot wave=${msg.wave} sessionLen=${msg.session.length} ${waiter ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (waiter) {
          this.lastLaunchSnapshot = null;
          waiter(msg.session);
          return;
        }
        this.lastLaunchSnapshot = { wave: msg.wave, session: msg.session };
        return;
      }
      case "meBattleEnemyPartySync": {
        // Hand it straight to a parked awaitMeBattleEnemyParty (consumed), else buffer for the
        // next await (the host may race ahead of the guest reaching the handoff). Keyed by the
        // ME interaction so two ME battles in a wave never collide (#633 ME handoff).
        const waiter = this.meBattlePartyWaiters.get(msg.key);
        coopLog(
          "stream",
          `guest RECV meBattleEnemyPartySync key=${msg.key} count=${msg.enemies.length} ${waiter ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
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
          ...(msg.fullField === undefined ? {} : { fullField: msg.fullField }),
          ...(msg.authoritativeState === undefined ? {} : { authoritativeState: msg.authoritativeState }),
        };
        const resolver = this.pending.get(msg.turn);
        coopLog(
          "replay",
          `guest RECV turnResolution turn=${msg.turn} events=${msg.events.length} checksum=${msg.checksum} ${resolver ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (resolver) {
          resolver(res);
        } else {
          // No waiter yet - buffer (latest per turn wins) for the next awaitTurn.
          if (this.inbox.has(msg.turn)) {
            coopWarn(
              "stream",
              `guest RECV turnResolution turn=${msg.turn} superseding earlier buffered (no waiter, latest wins)`,
            );
          }
          this.inbox.set(msg.turn, res);
        }
        return;
      }
      case "battleEvent": {
        // GUEST: buffer the live event by (turn, seq) - de-duped (a re-sent seq overwrites identically)
        // and order-tolerant (the seq, not arrival order, drives replay). Then fire any live handler.
        // HOT PATH (per battle event): build the trace string only when debug is on.
        if (isCoopDebug()) {
          coopLog("replay", `guest RECV live battleEvent turn=${msg.turn} seq=${msg.seq} k=${msg.event.k}`);
        }
        let perTurn = this.liveEvents.get(msg.turn);
        if (perTurn == null) {
          perTurn = new Map<number, CoopBattleEvent>();
          this.liveEvents.set(msg.turn, perTurn);
        }
        perTurn.set(msg.seq, msg.event);
        this.liveEventHandler?.(msg.turn, msg.seq, msg.event);
        this.liveWaiter?.(msg.turn, msg.seq);
        return;
      }
      case "battleCheckpoint":
        // Buffer for the guest's next consumeCheckpoint() (applied at a turn boundary),
        // carrying the host's checksum so the guest can verify convergence after applying.
        coopLog("checksum", `guest RECV battleCheckpoint reason=${msg.reason} checksum=${msg.checksum}`);
        this.lastCheckpoint = {
          reason: msg.reason,
          checkpoint: msg.checkpoint,
          checksum: msg.checksum,
          ...(msg.authoritativeState === undefined ? {} : { authoritativeState: msg.authoritativeState }),
        };
        this.checkpointWaiter?.();
        this.checkpointHandler?.(msg.reason, msg.checkpoint);
        return;
      case "requestEnemyParty":
        // HOST: the guest re-requested its enemy party (its original sync was lost, or it
        // reached the await before the host generated). Hand it to the host's re-broadcaster
        // (a no-op before the host has the party for that wave).
        coopLog("stream", `host RECV requestEnemyParty wave=${msg.wave}`);
        if (this.enemyPartyRequestHandler == null) {
          coopWarn("stream", `host RECV requestEnemyParty wave=${msg.wave} DROPPED (no handler registered)`);
        }
        this.enemyPartyRequestHandler?.(msg.wave);
        return;
      case "requestStateSync":
        // HOST: the guest detected a desync - hand the request to the host's builder.
        coopLog("resync", `host RECV requestStateSync turn=${msg.turn} seq=${msg.seq}`);
        if (this.stateSyncRequestHandler == null) {
          coopWarn(
            "resync",
            `host RECV requestStateSync turn=${msg.turn} seq=${msg.seq} DROPPED (no handler registered)`,
          );
        }
        this.stateSyncRequestHandler?.(msg.turn, msg.seq);
        return;
      case "stateSync": {
        // GUEST: deliver to a parked awaiter for this seq, else buffer it (race).
        const waiter = this.stateSyncWaiters.get(msg.seq);
        coopLog(
          "resync",
          `guest RECV stateSync seq=${msg.seq} blobLen=${msg.blob.length} ${waiter ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (waiter) {
          waiter(msg.blob);
        } else {
          this.stateSyncInbox.set(msg.seq, msg.blob);
        }
        return;
      }
      case "meChecksum":
        // WATCHER: the owner's ME-boundary checksum - verify + heal on mismatch.
        coopLog("checksum", `watcher RECV meChecksum seq=${msg.seq} checksum=${msg.checksum}`);
        if (this.meChecksumHandler == null) {
          coopWarn("checksum", `watcher RECV meChecksum seq=${msg.seq} DROPPED (no handler registered)`);
        }
        this.meChecksumHandler?.(msg.seq, msg.checksum);
        return;
      case "meMessage":
        // GUEST: one host-authoritative ME narration line - the diverted CoopReplayMePhase queues it.
        // HOT PATH (per narration line): build the trace string only when debug is on.
        if (isCoopDebug()) {
          coopLog(
            "stream",
            `guest RECV meMessage len=${msg.text.length} ${this.meMessageHandler == null ? "-> DROPPED (no handler)" : "-> handler"}`,
          );
        }
        this.meMessageHandler?.(msg.text);
        return;
      case "waveResolved":
        // GUEST: the host cleared/ended this wave - run the normal post-battle tail.
        coopLog(
          "replay",
          `guest RECV waveResolved wave=${msg.wave} outcome=${msg.outcome}${msg.captureParty == null ? "" : ` captureParty=${msg.captureParty.length}`}${msg.capturePresentation == null ? "" : ` cap=sp${msg.capturePresentation.speciesId}`}`,
        );
        if (this.waveResolvedHandler == null) {
          coopWarn("replay", `guest RECV waveResolved wave=${msg.wave} DROPPED (no handler registered)`);
        }
        this.waveResolvedHandler?.(msg.wave, msg.outcome, msg.captureParty, msg.capturePresentation);
        return;
      case "waveEndState":
        // GUEST (#838): the host's WAVE-END authoritative full-state snapshot - the guest adopts it in
        // BattleEndPhase so its levels / exp / learned moves / evolved species converge in the shop window.
        coopLog("replay", `guest RECV waveEndState wave=${msg.wave} tick=${msg.state.tick}`);
        if (this.waveEndStateHandler == null) {
          coopWarn("replay", `guest RECV waveEndState wave=${msg.wave} DROPPED (no handler registered)`);
        }
        this.waveEndStateHandler?.(msg.wave, msg.state);
        return;
      case "ghostPool":
        // Deliver to a live handler, else buffer (the broadcast can land before the
        // guest's runtime wiring subscribes - it's sent eagerly on prefetch-resolve).
        coopLog(
          "stream",
          `guest RECV ghostPool count=${msg.pool.length} ${this.ghostPoolHandler == null ? "-> buffered (no handler yet)" : "-> handler"}`,
        );
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

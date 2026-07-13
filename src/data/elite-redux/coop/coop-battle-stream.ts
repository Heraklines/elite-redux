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

import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopWaveAdvancePayload } from "#data/elite-redux/coop/coop-operation-envelope";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopCapturePresentation,
  CoopConnectionState,
  CoopEncounterAuthority,
  CoopFullMonSnapshot,
  CoopLaunchSnapshotAbortReason,
  CoopMessage,
  CoopSerializedEnemy,
  CoopTransport,
  CoopWaveOutcome,
} from "#data/elite-redux/coop/coop-transport";
// TYPE-ONLY (erased at runtime): the host's ghost-team pool the guest adopts (#633).
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";

/** A fully-resolved turn the guest renders: ordered events + the authoritative state. */
export interface CoopTurnResolution {
  epoch: number;
  wave: number;
  turn: number;
  revision: number;
  events: CoopBattleEvent[];
  checkpoint: CoopBattleCheckpoint;
  /** The host's full-state checksum at this boundary (#633, TRACK-2). */
  checksum: string;
  /** The host's canonical state pre-image the `checksum` hashed (#633, diagnostics). */
  preimage: string;
  /**
   * The host's COMPLETE per-mon on-field snapshot (#633 M2): heals the on-field state the numeric
   * `checkpoint` omits (moveset+PP / tera / boss / held items / ability / form) IN-LINE this turn.
   * Required by protocol 31; mixed older hosts are rejected during hello negotiation.
   */
  fullField: CoopFullMonSnapshot[];
  /** Full normal-turn authoritative state. */
  authoritativeState: CoopAuthoritativeBattleStateV1;
}

/** An out-of-turn authoritative checkpoint + the host's matching full-state checksum. */
export interface CoopCheckpointEnvelope {
  reason: string;
  epoch: number;
  wave: number;
  turn: number;
  revision: number;
  checkpoint: CoopBattleCheckpoint;
  /** The host's full-state checksum at this boundary (#633, TRACK-2). */
  checksum: string;
  /** Complete per-mon field companion for a modern out-of-band authority frame. */
  fullField: CoopFullMonSnapshot[];
  /** Full authoritative state for intra-turn boundaries such as replacement unblock. */
  authoritativeState: CoopAuthoritativeBattleStateV1;
}

/** Options for {@linkcode CoopBattleStreamer} (timer injection for tests). */
export interface CoopBattleStreamerOptions {
  /** How long the guest waits for a turn's resolution before giving up. Default 60s. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
  /** Clock paired with the injected scheduler so absolute retry deadlines stay deterministic in tests. */
  now?: () => number;
  /** Production address source used to reject cross-session/wave traffic before buffering it. */
  authorityContext?: () => { epoch: number; wave: number; turn: number };
}

export type CoopAuthorityFailure = Extract<CoopMessage, { t: "authorityFailure" }>;

const AUTHORITY_RETRY_MS = 2_000;
const AUTHORITY_FATAL_RETRY_MS = 500;
const AUTHORITY_FATAL_DEADLINE_MS = 3_000;
const AUTHORITY_ACK_RETENTION = 32;

function rememberBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  while (map.size > AUTHORITY_ACK_RETENTION) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

function isSafeAddressPart(value: unknown, allowZero = true): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidBattlerIndex(value: unknown): value is number {
  // Protocol 32 supports the current single/double/triple topology and leaves room for six seats per side.
  // A future topology protocol replaces this conservative ceiling with the negotiated manifest.
  return isSafeAddressPart(value) && value <= 11;
}

function isNumberArray(value: unknown, length?: number): value is number[] {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every(isFiniteNumber);
}

function isStrictChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/i.test(value) && value !== COOP_CHECKSUM_SENTINEL;
}

function isStrictFullField(value: unknown): value is CoopFullMonSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const seen = new Set<number>();
  for (const raw of value) {
    if (raw == null || typeof raw !== "object") {
      return false;
    }
    const bi = (raw as { bi?: unknown }).bi;
    const mon = raw as Record<string, unknown>;
    if (
      !isValidBattlerIndex(bi)
      || seen.has(bi)
      || !isSafeAddressPart(mon.partyIndex)
      || !isSafeAddressPart(mon.speciesId, false)
      || !isFiniteNumber(mon.hp)
      || (mon.hp as number) < 0
      || !isFiniteNumber(mon.maxHp)
      || (mon.maxHp as number) <= 0
      || !isSafeAddressPart(mon.status)
      || !isNumberArray(mon.statStages, 7)
      || typeof mon.fainted !== "boolean"
      || !isSafeAddressPart(mon.abilityId)
      || !isSafeAddressPart(mon.formIndex)
      || !Array.isArray(mon.moves)
      || !mon.moves.every(
        move =>
          Array.isArray(move) && move.length === 2 && isSafeAddressPart(move[0], false) && isSafeAddressPart(move[1]),
      )
      || !Array.isArray(mon.tags) // BattlerTagType is a string enum at runtime.  The historical wire type calls these // `number[]` through an unsafe cast, so accepting numbers as well keeps old captures // readable while allowing the production values (for example "SEEDED"/"ENCORE").
      || !mon.tags.every(tag => (typeof tag === "string" && tag.length > 0) || isSafeAddressPart(tag))
    ) {
      return false;
    }
    seen.add(bi);
  }
  return true;
}

function isStrictCheckpoint(value: unknown): value is CoopBattleCheckpoint {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const checkpoint = value as CoopBattleCheckpoint;
  if (
    !isSafeAddressPart(checkpoint.tick, false)
    || !Array.isArray(checkpoint.field)
    || checkpoint.field.length === 0
    || typeof checkpoint.weather !== "number"
    || typeof checkpoint.weatherTurnsLeft !== "number"
    || typeof checkpoint.terrain !== "number"
    || typeof checkpoint.terrainTurnsLeft !== "number"
  ) {
    return false;
  }
  const seen = new Set<number>();
  return checkpoint.field.every(raw => {
    if (raw == null || typeof raw !== "object") {
      return false;
    }
    const mon = raw as unknown as Record<string, unknown>;
    const valid =
      isValidBattlerIndex(mon.bi)
      && !seen.has(mon.bi as number)
      && isSafeAddressPart(mon.partyIndex)
      && isSafeAddressPart(mon.speciesId, false)
      && isFiniteNumber(mon.hp)
      && (mon.hp as number) >= 0
      && isFiniteNumber(mon.maxHp)
      && (mon.maxHp as number) > 0
      && isSafeAddressPart(mon.status)
      && isNumberArray(mon.statStages, 7)
      && typeof mon.fainted === "boolean";
    if (valid) {
      seen.add(mon.bi as number);
    }
    return valid;
  });
}

function isStrictBattleEvent(value: unknown): value is CoopBattleEvent {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  switch (event.k) {
    case "message":
      return typeof event.text === "string";
    case "moveUsed":
      return (
        isValidBattlerIndex(event.bi)
        && isSafeAddressPart(event.moveId, false)
        && Array.isArray(event.targets)
        && event.targets.every(isValidBattlerIndex)
      );
    case "hp":
      return (
        isValidBattlerIndex(event.bi)
        && isFiniteNumber(event.hp)
        && event.hp >= 0
        && isFiniteNumber(event.maxHp)
        && event.maxHp > 0
        && (event.sp === undefined || isFiniteNumber(event.sp))
      );
    case "faint":
      return (
        isValidBattlerIndex(event.bi)
        && (event.narrate === undefined || typeof event.narrate === "boolean")
        && (event.sp === undefined || isFiniteNumber(event.sp))
      );
    case "statStage":
      return isValidBattlerIndex(event.bi) && isSafeAddressPart(event.stat) && isFiniteNumber(event.value);
    case "status":
      return isValidBattlerIndex(event.bi) && isSafeAddressPart(event.status);
    case "weather":
      return isSafeAddressPart(event.weather) && isSafeAddressPart(event.turnsLeft);
    case "terrain":
      return isSafeAddressPart(event.terrain) && isSafeAddressPart(event.turnsLeft);
    case "switch":
      return isValidBattlerIndex(event.bi) && isSafeAddressPart(event.partySlot);
    default:
      return false;
  }
}

function isStrictAuthoritativeState(value: unknown): value is CoopAuthoritativeBattleStateV1 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const state = value as CoopAuthoritativeBattleStateV1;
  const partiesValid = [state.playerParty, state.enemyParty].every(
    party =>
      Array.isArray(party)
      && party.length > 0
      && party.every(mon => mon != null && typeof mon === "object" && isSafeAddressPart(mon.id)),
  );
  const seenSeats = new Set<number>();
  const fieldValid =
    Array.isArray(state.field)
    && state.field.length > 0
    && state.field.every(seat => {
      const valid =
        (seat.side === "player" || seat.side === "enemy")
        && isValidBattlerIndex(seat.bi)
        && !seenSeats.has(seat.bi)
        && isSafeAddressPart(seat.partyIndex)
        && isSafeAddressPart(seat.pokemonId)
        && typeof seat.presented === "boolean";
      if (valid) {
        seenSeats.add(seat.bi);
      }
      return valid;
    });
  return (
    state.version === 1
    && isSafeAddressPart(state.tick, false)
    && isSafeAddressPart(state.wave, false)
    && isSafeAddressPart(state.turn, false)
    && partiesValid
    && fieldValid
    && isSafeAddressPart(state.weather)
    && isSafeAddressPart(state.weatherTurnsLeft)
    && isSafeAddressPart(state.terrain)
    && isSafeAddressPart(state.terrainTurnsLeft)
    && Array.isArray(state.arenaTags)
    && state.arenaTags.every(tag => tag != null && typeof tag === "object")
    && isFiniteNumber(state.money)
    && Array.isArray(state.pokeballCounts)
    && state.pokeballCounts.every(
      entry => Array.isArray(entry) && entry.length === 2 && isSafeAddressPart(entry[0]) && isSafeAddressPart(entry[1]),
    )
    && Array.isArray(state.playerModifiers)
    && state.playerModifiers.every(modifier => modifier != null && typeof modifier === "object")
    && Array.isArray(state.enemyModifiers)
    && state.enemyModifiers.every(modifier => modifier != null && typeof modifier === "object")
  );
}

function hasCompleteAuthorityCompanions(
  msg: Pick<
    CoopCheckpointEnvelope,
    "epoch" | "wave" | "turn" | "revision" | "checkpoint" | "checksum" | "fullField" | "authoritativeState"
  >,
): boolean {
  const state = msg.authoritativeState;
  if (
    !isSafeAddressPart(msg.epoch, false)
    || !isSafeAddressPart(msg.wave, false)
    || !isSafeAddressPart(msg.turn, false)
    || !isSafeAddressPart(msg.revision, false)
    || !isStrictChecksum(msg.checksum)
    || !isStrictCheckpoint(msg.checkpoint)
    || !isStrictFullField(msg.fullField)
    || !isStrictAuthoritativeState(state)
    || state.tick !== msg.revision
    || state.tick <= (msg.checkpoint.tick as number)
    || state.wave !== msg.wave
    || state.turn !== msg.turn
    || !Array.isArray(state.playerParty)
    || !Array.isArray(state.enemyParty)
    || !Array.isArray(state.field)
  ) {
    return false;
  }
  const checkpointBis = new Set(msg.checkpoint.field.map(mon => mon.bi));
  const fullFieldBis = new Set(msg.fullField.map(mon => mon.bi));
  const stateBis = new Set(state.field.map(seat => seat.bi));
  return (
    checkpointBis.size === fullFieldBis.size
    && checkpointBis.size === stateBis.size
    && [...checkpointBis].every(bi => fullFieldBis.has(bi) && stateBis.has(bi))
  );
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

/** Reserved `stateSync.seq` for an unsolicited durability deep-gap snapshot (§4.4). */
export const COOP_DURABILITY_SNAPSHOT_SEQ = -2_147_000_000;

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

function authorityKey(address: { epoch: number; wave: number; turn: number; revision: number }): string {
  return `${address.epoch}:${address.wave}:${address.turn}:${address.revision}`;
}

function pendingTurnKey(address: { epoch: number; wave: number; turn: number }): string {
  return `${address.epoch}:${address.wave}:${address.turn}`;
}

interface CoopTurnAddress {
  epoch: number;
  wave: number;
  turn: number;
}

interface PendingTurnWaiter {
  turn: number;
  address: CoopTurnAddress | null;
  finish: (res: CoopTurnResolution | null) => void;
}

interface LiveTurnBuffer {
  address: CoopTurnAddress;
  events: Map<number, CoopBattleEvent>;
}

function legacyTurnKey(turn: number): string {
  return `legacy:${turn}`;
}

function invalidAuthorityTurnKey(turn: number): string {
  return `invalid:${turn}`;
}

function sameTurnAddress(left: CoopTurnAddress, right: CoopTurnAddress): boolean {
  return left.epoch === right.epoch && left.wave === right.wave && left.turn === right.turn;
}

function sameAuthorityAddress(
  left: { epoch: number; wave: number; turn: number; revision: number },
  right: { epoch: number; wave: number; turn: number; revision: number },
): boolean {
  return (
    left.epoch === right.epoch
    && left.wave === right.wave
    && left.turn === right.turn
    && left.revision === right.revision
  );
}

function authorityFailureKey(failure: CoopAuthorityFailure): string {
  return `${failure.failureId}:${failure.epoch}:${failure.wave}:${failure.turn}:${failure.revision}:${failure.boundary}`;
}

/**
 * Rides on a {@linkcode CoopTransport} to stream host-authoritative battle state to
 * the guest. One instance per client. The HOST calls the `send*` methods; the GUEST
 * registers `onEnemyPartySync` / `onCheckpoint` and `await`s {@linkcode awaitTurn}.
 *
 * Turn resolutions are matched by the complete `(epoch, wave, turn)` address. Because the two clients
 * are NOT time-locked (the host may finish + send turn N before the guest reaches its await), a resolution
 * that arrives with no waiter is BUFFERED at that exact address and consumed by the matching
 * {@linkcode awaitTurn} - the same race fix the command relay uses without bare-turn aliasing.
 */
export class CoopBattleStreamer {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private readonly authorityContext: (() => { epoch: number; wave: number; turn: number }) | undefined;
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;

  /** Complete turn address -> resolver for an in-flight {@linkcode awaitTurn}. */
  private readonly pending = new Map<string, PendingTurnWaiter>();
  /** #806 stall watchdog: when each parked turn wait began (same keys as `pending`). */
  private readonly pendingSince = new Map<string, number>();
  /** Complete turn address -> a resolution that arrived before its waiter (race buffer). */
  private readonly inbox = new Map<string, CoopTurnResolution>();
  /** HOST: complete turn commits remain replayable until the guest ACKs exact convergence. */
  private readonly sentTurnCommits = new Map<string, Extract<CoopMessage, { t: "turnResolution" }>>();
  private readonly sentTurnCommitTimers = new Map<string, () => void>();
  /** GUEST: every turn requested but not yet apply+checksum ACKed, including reconnect replay. */
  private readonly requestedTurnCommits = new Map<
    string,
    { epoch: number; wave: number; turn: number; revision?: number }
  >();
  private readonly turnRequestTimers = new Map<string, () => void>();
  private readonly turnCommitHandlers = new Set<(resolution: CoopTurnResolution) => void>();
  private readonly ackedTurnCommits = new Map<string, Extract<CoopMessage, { t: "turnCommitAck" }>>();
  /**
   * GUEST: live battle events buffered by turn, keyed inner by `seq` so a duplicate / out-of-order
   * `battleEvent` is de-duped + a stutter (a missing seq) is tolerated (#633, animation layer LIVE).
   * Consumed in seq order by `CoopReplayTurnPhase` at the turn boundary, so the guest never replays a
   * live event twice (it de-dupes the turn-end batch against these). A bounded number of past turns is
   * retained ({@linkcode LIVE_EVENT_TURN_RETENTION}) so a late event for a just-finished turn is not
   * silently dropped while old turns never leak.
   */
  private readonly liveEvents = new Map<string, LiveTurnBuffer>();
  /** GUEST: live-event arrival handler (optional; lets a live pump react the instant one lands). */
  private liveEventHandler: ((turn: number, seq: number, event: CoopBattleEvent) => void) | null = null;
  /** GUEST: one-shot live-arrival waiter for the pump race ({@linkcode awaitTurnOrLiveEvent}). */
  private liveWaiter: ((address: CoopTurnAddress, seq: number) => void) | null = null;
  /** GUEST: one-shot OUT-OF-BAND-checkpoint waiter for the pump race (#633 guest-faint deadlock). */
  private checkpointWaiter: ((envelope: CoopCheckpointEnvelope) => void) | null = null;
  /**
   * GUEST (#790, the post-resync strand): the last (wave, turn) whose resolution was HANDED TO A
   * FINALIZE. A duplicate CoopReplayTurnPhase for an already-finalized turn (leftover pump
   * continuation racing a resync) must END instead of parking 20 minutes on a resolution the
   * host will never resend. Per-session by construction (a new session builds a new streamer).
   */
  private readonly finalizedMarks = new Map<string, { epoch: number; wave: number; turn: number }>();

  markTurnFinalized(epoch: number, wave: number, turn: number): void {
    if (!isSafeAddressPart(epoch, false) || !isSafeAddressPart(wave, false) || !isSafeAddressPart(turn, false)) {
      return;
    }
    const key = `${epoch}:${wave}`;
    const previous = this.finalizedMarks.get(key);
    if (previous == null || turn > previous.turn) {
      rememberBounded(this.finalizedMarks, key, { epoch, wave, turn });
    }
  }

  isTurnFinalized(wave: number, turn: number): boolean {
    if (this.authorityContext == null) {
      return [...this.finalizedMarks.values()].some(mark => mark.wave === wave && turn <= mark.turn);
    }
    const current = this.currentAuthorityAddress(turn);
    if (current == null || current.wave !== wave) {
      return false;
    }
    const mark = this.finalizedMarks.get(`${current.epoch}:${wave}`);
    return mark != null && turn <= mark.turn;
  }

  /**
   * #790 REGRESSION FIX (live "after even normal combat we are stuck"): the guest's
   * currentBattle.waveIndex may not have ticked yet when the NEXT wave's first replay phase
   * starts, so a mark from the finished wave (same waveIndex, turn 1) wrongly killed the new
   * wave's turn 1 in a loop. Clear the mark the moment the guest processes a wave advance -
   * the mark only ever exists to kill duplicates WITHIN the wave it was set in.
   */
  clearFinalizedMark(): void {
    this.finalizedMarks.clear();
  }

  private enemyPartyHandler: ((wave: number, enemies: CoopSerializedEnemy[]) => void) | null = null;
  private checkpointHandler: ((reason: string, checkpoint: CoopBattleCheckpoint) => void) | null = null;
  /**
   * GUEST: safe-boundary observers for the complete checkpoint envelope. Unlike
   * {@linkcode checkpointHandler}, these are subscriptions rather than a singleton because a held
   * recovery phase may temporarily listen for a strictly-newer authority frame without replacing a
   * presentation observer. The receiver retains one latest envelope per complete turn address.
   */
  private readonly checkpointEnvelopeHandlers = new Set<(envelope: CoopCheckpointEnvelope) => void>();
  /** wave -> resolver for an in-flight {@linkcode awaitEnemyParty}. */
  private readonly enemyPartyWaiters = new Map<number, (res: CoopSerializedEnemy[] | null) => void>();
  /** ME-battle key -> resolver for an in-flight {@linkcode awaitMeBattleEnemyParty} (#633 ME handoff). */
  private readonly meBattlePartyWaiters = new Map<string, (res: CoopSerializedEnemy[] | null) => void>();
  /** ME-battle key -> a party that arrived before its waiter (race buffer, #633 ME handoff). */
  private readonly meBattlePartyInbox = new Map<string, CoopSerializedEnemy[]>();
  /** HOST: retained authoritative ME parties, re-answerable by exact interaction key after loss/reconnect. */
  private readonly sentMeBattleParties = new Map<string, CoopSerializedEnemy[]>();
  /** Complete turn address -> latest authoritative checkpoint the guest has not yet applied. */
  private readonly pendingCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  /** HOST: latest complete replacement frame, retained for explicit guest retransmit requests. */
  private readonly sentReplacementCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  private readonly sentReplacementTimers = new Map<string, () => void>();
  private readonly ackedReplacementCommits = new Map<string, Extract<CoopMessage, { t: "battleCheckpointAck" }>>();
  /** HOST: bounded proof that a causally newer replacement was ACKed before an old turn is superseded. */
  private readonly hostAppliedReplacementAcks = new Map<string, Extract<CoopMessage, { t: "battleCheckpointAck" }>>();
  private authorityFailureHandlers = new Set<(failure: CoopAuthorityFailure) => void>();
  private lastAuthorityFailure: CoopAuthorityFailure | null = null;
  /** Receiver-side exactly-once guard: duplicates are re-ACKed without routing terminal cleanup twice. */
  private readonly ackedAuthorityFailures = new Map<string, Extract<CoopMessage, { t: "authorityFailureAck" }>>();
  private pendingAuthorityFailure: {
    message: CoopAuthorityFailure;
    deadline: number;
    cancel: () => void;
    resolve: (acked: boolean) => void;
  } | null = null;
  private authorityFailureRevision = 0;
  /**
   * Latest out-of-band checkpoint the live replay pump already applied to unblock an
   * intra-turn interaction. Presentation phases can subsequently mutate that state
   * before the older turn-resolution finalizer runs, so the finalizer consumes this
   * envelope and reasserts its newer full state at the safe post-animation boundary.
   */
  private readonly appliedOutOfBandCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  /** Latest enemy party the guest has not yet adopted (consumed at the wave's first turn). */
  private lastEnemyParty: { wave: number; enemies: CoopSerializedEnemy[] } | null = null;
  /** HOST: exact wave-boundary carriers retained for loss/reconnect replay. */
  private readonly sentEnemyParties = new Map<number, Extract<CoopMessage, { t: "enemyPartySync" }>>();
  /** New-wave state paired with enemyPartySync; consumed after the guest has built the streamed enemies. */
  private readonly enemyPartyStateByWave = new Map<number, CoopAuthoritativeBattleStateV1>();
  /** Complete encounter identity paired with the replayable wave carrier; consumed atomically at adopt. */
  private readonly enemyPartyEncounterByWave = new Map<number, CoopEncounterAuthority>();
  /** wave -> resolver for an in-flight {@linkcode awaitLaunchSnapshot} (#633 M4 push-snapshot launch). */
  private readonly launchSnapshotWaiters = new Map<number, (res: string | null) => void>();
  /** Latest launch snapshot that arrived before its waiter (race buffer, keyed by wave). */
  private lastLaunchSnapshot: { wave: number; session: string } | null = null;
  /** A host fresh-run allocation failure, buffered if it beats the guest's launch waiter. */
  private readonly launchSnapshotAbortWaves = new Set<number>();
  /** Guest-side exact-once guard: reconnect resends cannot leave a second snapshot buffered. */
  private readonly consumedLaunchSnapshotWaves = new Set<number>();
  /** HOST: latest authoritative launch/resume snapshot, retained so a lost push is re-answerable. */
  private lastSentLaunchSnapshot: { wave: number; session: string } | null = null;
  /** HOST: mutually-exclusive retained launch failure, re-answerable after loss/reconnect. */
  private lastSentLaunchSnapshotAbort: Extract<CoopMessage, { t: "launchSnapshotAbort" }> | null = null;
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
  /** GUEST: live apply callback for an unsolicited deep-gap durability snapshot. */
  private durabilitySnapshotHandler: ((blob: string) => void) | null = null;
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
        transition?: CoopWaveAdvancePayload,
      ) => void)
    | null = null;
  /** GUEST: handler for the host's WAVE-END authoritative full-state snapshot (#838). */
  private waveEndStateHandler: ((wave: number, state: CoopAuthoritativeBattleStateV1) => void) | null = null;

  /** GUEST (#825): the host's rolled ME type per wave (from enemyPartySync). */
  private readonly meTypeByWave = new Map<number, number>();

  /** GUEST (#867): the host's authoritative WILD-vs-TRAINER verdict per wave (from enemyPartySync). */
  private readonly battleTypeByWave = new Map<number, number>();

  /**
   * GUEST (#867): the host's authoritative `BattleType` for `wave`, if its wave-start sync arrived.
   * The guest re-deriving the wave TYPE via `isWaveTrainer` (an arena-trainerChance / biome-overstay /
   * seeded roll) diverges from the host once its arena/overstay state drifts - the god-leg soak's
   * wave-42 `saveDataDigest` `battleType` split (host TRAINER, guest WILD), a checksum mismatch every
   * turn until a resync heals it, and the "wild"-thinking guest mishandling the trainer's mid-battle
   * send-outs. So the wave TYPE is HOST-AUTHORITATIVE: the guest adopts this verdict instead of rolling.
   * `undefined` = no wave-start sync received yet. `newBattle` may build a provisional local shell,
   * but EncounterPhase remains closed until the replayable carrier arrives and atomically overwrites it.
   */
  battleTypeForWave(wave: number): number | undefined {
    return this.battleTypeByWave.get(wave);
  }

  /**
   * GUEST (#825/#862): the host's ME verdict for `wave`, if its wave-start sync arrived.
   * `>= 0` = the host rolled THIS MysteryEncounterType; {@linkcode COOP_WAVE_NO_ME} = the
   * host explicitly rolled NO ME (#862: the guest's own presence roll depends on per-client
   * pity state that diverges after any one-sided ME anomaly - same seed, different verdict -
   * so the guest must adopt the host's verdict in BOTH directions); `undefined` = no
   * wave-start sync received yet. A provisional local shell is never allowed past EncounterPhase;
   * the replayable encounter descriptor overwrites the final verdict before rendering.
   */
  meTypeForWave(wave: number): number | undefined {
    return this.meTypeByWave.get(wave);
  }

  constructor(transport: CoopTransport, opts: CoopBattleStreamerOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.now = opts.now ?? Date.now;
    this.authorityContext = opts.authorityContext;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offStateChange = transport.onStateChange((state: CoopConnectionState) => {
      if (state !== "connected") {
        return;
      }
      for (const commit of this.sentTurnCommits.values()) {
        coopLog(
          "stream",
          `host RE-SEND retained turn commit e=${commit.epoch} wave=${commit.wave} turn=${commit.turn} rev=${commit.revision} after reconnect`,
        );
        this.transport.send(commit);
      }
      for (const replacement of this.sentReplacementCheckpoints.values()) {
        this.transport.send({ t: "battleCheckpoint", ...replacement });
      }
      if (this.pendingAuthorityFailure != null) {
        this.transport.send(this.pendingAuthorityFailure.message);
      }
      for (const request of this.requestedTurnCommits.values()) {
        this.sendTurnCommitRequest(request);
      }
      for (const wave of this.launchSnapshotWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestLaunchSnapshot wave=${wave} after reconnect`);
        this.transport.send({ t: "requestLaunchSnapshot", wave });
      }
      for (const wave of this.enemyPartyWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestEnemyParty wave=${wave} after reconnect`);
        this.transport.send({ t: "requestEnemyParty", wave });
      }
      for (const key of this.meBattlePartyWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestMeBattleEnemyParty key=${key} after reconnect`);
        this.transport.send({ t: "requestMeBattleEnemyParty", key });
      }
    });
    coopLog("stream", `streamer CONSTRUCT timeout=${this.timeoutMs}ms onMessage registered`);
  }

  private currentAuthorityAddress(turn?: number): { epoch: number; wave: number; turn: number } | null {
    if (this.authorityContext == null) {
      return null;
    }
    if (turn !== undefined && !isSafeAddressPart(turn, false)) {
      return null;
    }
    try {
      const current = this.authorityContext();
      if (
        current == null
        || !isSafeAddressPart(current.epoch, false)
        || !isSafeAddressPart(current.wave, false)
        || !isSafeAddressPart(current.turn, false)
      ) {
        return null;
      }
      return { ...current, ...(turn === undefined ? {} : { turn }) };
    } catch {
      return null;
    }
  }

  private acceptsCurrentAddress(address: { epoch: number; wave: number; turn: number }, exactTurn = true): boolean {
    if (this.authorityContext == null) {
      return true;
    }
    const current = this.currentAuthorityAddress();
    if (current == null) {
      return false;
    }
    return (
      address.epoch === current.epoch && address.wave === current.wave && (!exactTurn || address.turn === current.turn)
    );
  }

  private acceptsAwaitedTurnAddress(address: CoopTurnAddress): boolean {
    if (this.authorityContext == null) {
      return true;
    }
    const current = this.currentAuthorityAddress();
    if (current == null || current.epoch !== address.epoch || current.wave !== address.wave) {
      return false;
    }
    const key = pendingTurnKey(address);
    return current.turn === address.turn || this.pending.has(key) || this.requestedTurnCommits.has(key);
  }

  private turnWaitAddress(turn: number): { key: string; address: CoopTurnAddress | null } {
    const address = this.currentAuthorityAddress(turn);
    if (address != null) {
      return { key: pendingTurnKey(address), address };
    }
    return {
      key: this.authorityContext == null ? legacyTurnKey(turn) : invalidAuthorityTurnKey(turn),
      address: null,
    };
  }

  private bufferedTurnEntry(turn: number): [string, CoopTurnResolution] | undefined {
    const current = this.currentAuthorityAddress(turn);
    if (this.authorityContext != null) {
      if (current == null) {
        return;
      }
      const key = pendingTurnKey(current);
      const resolution = this.inbox.get(key);
      return resolution === undefined ? undefined : [key, resolution];
    }
    return [...this.inbox.entries()].reverse().find(([, resolution]) => resolution.turn === turn);
  }

  private liveTurnEntry(turn: number): [string, LiveTurnBuffer] | undefined {
    const current = this.currentAuthorityAddress(turn);
    if (this.authorityContext != null) {
      if (current == null) {
        return;
      }
      const key = pendingTurnKey(current);
      const buffer = this.liveEvents.get(key);
      return buffer === undefined ? undefined : [key, buffer];
    }
    return [...this.liveEvents.entries()].reverse().find(([, buffer]) => buffer.address.turn === turn);
  }

  private currentCheckpointEntry(): [string, CoopCheckpointEnvelope] | undefined {
    const current = this.currentAuthorityAddress();
    if (this.authorityContext != null) {
      if (current == null) {
        return;
      }
      const key = pendingTurnKey(current);
      const checkpoint = this.pendingCheckpoints.get(key);
      return checkpoint === undefined ? undefined : [key, checkpoint];
    }
    return [...this.pendingCheckpoints.entries()].at(-1);
  }

  private checkpointCanWakeTurn(
    envelope: CoopCheckpointEnvelope,
    waitedAddress: CoopTurnAddress | null,
    legacyTurn: number,
  ): boolean {
    if (waitedAddress == null) {
      return this.authorityContext == null && envelope.turn === legacyTurn;
    }
    return (
      envelope.epoch === waitedAddress.epoch
      && envelope.wave === waitedAddress.wave
      && (envelope.turn === waitedAddress.turn
        || (envelope.reason === "replacement" && envelope.turn === waitedAddress.turn + 1))
    );
  }

  private retainAndRetryTurnCommit(commit: Extract<CoopMessage, { t: "turnResolution" }>): void {
    const key = authorityKey(commit);
    this.sentTurnCommits.set(key, commit);
    this.sentTurnCommitTimers.get(key)?.();
    const retry = () => {
      const retained = this.sentTurnCommits.get(key);
      if (retained == null) {
        this.sentTurnCommitTimers.delete(key);
        return;
      }
      coopLog(
        "stream",
        `host RE-SEND unacked turn commit e=${retained.epoch} wave=${retained.wave} turn=${retained.turn} rev=${retained.revision}`,
      );
      this.transport.send(retained);
      this.sentTurnCommitTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
    };
    this.sentTurnCommitTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
  }

  private retainAndRetryReplacement(envelope: CoopCheckpointEnvelope): void {
    const key = authorityKey(envelope);
    this.sentReplacementCheckpoints.set(key, envelope);
    this.sentReplacementTimers.get(key)?.();
    const retry = () => {
      const retained = this.sentReplacementCheckpoints.get(key);
      if (retained == null) {
        this.sentReplacementTimers.delete(key);
        return;
      }
      coopLog(
        "checkpoint",
        `host RE-SEND unacked replacement e=${retained.epoch} wave=${retained.wave} turn=${retained.turn} rev=${retained.revision}`,
      );
      this.transport.send({ t: "battleCheckpoint", ...retained });
      this.sentReplacementTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
    };
    this.sentReplacementTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
  }

  // --- HOST side --------------------------------------------------------------

  /** HOST: send the exact enemy party the guest must adopt verbatim for `wave`. */
  sendEnemyParty(
    wave: number,
    enemies: CoopSerializedEnemy[],
    meType?: number,
    battleType?: number,
    authoritativeState?: CoopAuthoritativeBattleStateV1,
    encounter?: CoopEncounterAuthority,
  ): void {
    const retained = this.sentEnemyParties.get(wave);
    if (retained?.encounter !== undefined && encounter === undefined) {
      // A complete encounter carrier is monotonic authority. A later legacy/turn-boundary sender must
      // never overwrite or transmit a party-only version: the guest may consume that response first and
      // then fail closed because its required descriptor is absent (live wave-1 -> wave-2 regression).
      coopWarn("stream", `host IGNORE incomplete enemyPartySync downgrade wave=${wave} (complete carrier retained)`);
      return;
    }
    if (
      encounter !== undefined
      && ((meType !== undefined && encounter.mysteryEncounterType !== meType)
        || (battleType !== undefined && encounter.battleType !== battleType))
    ) {
      throw new Error(`Contradictory authoritative encounter metadata for wave ${wave}`);
    }
    const resolvedMeType = encounter?.mysteryEncounterType ?? meType;
    const resolvedBattleType = encounter?.battleType ?? battleType;
    const message: Extract<CoopMessage, { t: "enemyPartySync" }> = {
      t: "enemyPartySync",
      wave,
      enemies,
      ...(resolvedMeType === undefined ? {} : { meType: resolvedMeType }),
      ...(resolvedBattleType === undefined ? {} : { battleType: resolvedBattleType }),
      ...(encounter === undefined ? {} : { encounter }),
      ...(authoritativeState === undefined ? {} : { authoritativeState }),
    };
    this.sentEnemyParties.delete(wave);
    this.sentEnemyParties.set(wave, message);
    while (this.sentEnemyParties.size > 4) {
      const oldest = this.sentEnemyParties.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.sentEnemyParties.delete(oldest);
    }
    coopLog(
      "replay",
      `host SEND enemyPartySync wave=${wave} count=${enemies.length} meType=${resolvedMeType ?? "-"} battleType=${resolvedBattleType ?? "-"}`,
    );
    this.transport.send(message);
  }

  /** GUEST: consume the complete state paired with this wave's enemy-party handoff, if supplied. */
  consumeEnemyPartyState(wave: number): CoopAuthoritativeBattleStateV1 | undefined {
    const state = this.enemyPartyStateByWave.get(wave);
    this.enemyPartyStateByWave.delete(wave);
    return state;
  }

  /** GUEST: atomically consume the exact encounter identity paired with this wave's party. */
  consumeEnemyPartyEncounter(wave: number): CoopEncounterAuthority | undefined {
    const encounter = this.enemyPartyEncounterByWave.get(wave);
    this.enemyPartyEncounterByWave.delete(wave);
    return encounter;
  }

  /**
   * HOST (#633 M4 push-snapshot launch): PUSH the authoritative full session snapshot for `wave`
   * the instant the host's session is coherent (its EncounterPhase). `session` is a JSON-serialized
   * {@linkcode SessionSaveData} (`getSessionSaveData()`). The guest BOOTS from it - rolling no enemy /
   * arena / party of its own - so it can never diverge at launch (§3.6). Replaces the narrow
   * `enemyPartySync` + the `requestEnemyParty` poll for the launch (and every hard-transition) boundary.
   */
  sendLaunchSnapshot(wave: number, session: string): void {
    this.lastSentLaunchSnapshot = { wave, session };
    this.lastSentLaunchSnapshotAbort = null;
    coopLog("replay", `host SEND launchSnapshot wave=${wave} sessionLen=${session.length}`);
    this.transport.send({ t: "launchSnapshot", wave, session });
  }

  sendLaunchSnapshotAbort(wave: number, reason: CoopLaunchSnapshotAbortReason = "no-safe-slot"): void {
    const abort: Extract<CoopMessage, { t: "launchSnapshotAbort" }> = { t: "launchSnapshotAbort", wave, reason };
    this.lastSentLaunchSnapshot = null;
    this.lastSentLaunchSnapshotAbort = abort;
    coopWarn("stream", `host SEND launchSnapshotAbort wave=${wave} reason=${reason}`);
    this.transport.send(abort);
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
    this.sentMeBattleParties.delete(key);
    this.sentMeBattleParties.set(key, enemies);
    while (this.sentMeBattleParties.size > 8) {
      const oldest = this.sentMeBattleParties.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.sentMeBattleParties.delete(oldest);
    }
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
    epoch: number,
    wave: number,
    turn: number,
    events: CoopBattleEvent[],
    checkpoint: CoopBattleCheckpoint,
    checksum: string,
    preimage: string,
    fullField: CoopFullMonSnapshot[],
    authoritativeState: CoopAuthoritativeBattleStateV1,
  ): void {
    const revision = authoritativeState.tick;
    coopLog(
      "replay",
      `host SEND turnResolution e=${epoch} wave=${wave} turn=${turn} rev=${revision} events=${events.length} checksum=${checksum}`,
    );
    const commit: Extract<CoopMessage, { t: "turnResolution" }> = {
      t: "turnResolution",
      epoch,
      wave,
      turn,
      revision,
      events,
      checkpoint,
      checksum,
      preimage,
      fullField,
      authoritativeState,
    };
    if (!hasCompleteAuthorityCompanions(commit) || typeof preimage !== "string" || preimage.length === 0) {
      throw new Error(`refusing malformed turn commit e=${epoch} wave=${wave} turn=${turn} rev=${revision}`);
    }
    this.retainAndRetryTurnCommit(commit);
    this.transport.send(commit);
  }

  /**
   * HOST: emit ONE visible battle event LIVE (#633, animation layer), the instant the host records
   * it, so the guest can WATCH the fight unfold with minimal lag instead of waiting for the whole
   * turn to batch at turn-end. `seq` is a per-turn monotonic index the host supplies (so the guest
   * replays in order + de-dupes against the turn-end batch). PRESENTATION ONLY - the turn-end
   * checkpoint is still the source of truth, so a dropped / reordered live event only stutters.
   */
  emitEvent(epoch: number, wave: number, turn: number, seq: number, event: CoopBattleEvent): void {
    // HOT PATH (per battle event): build the trace string only when debug is on.
    if (isCoopDebug()) {
      coopLog("replay", `host EMIT live battleEvent turn=${turn} seq=${seq} k=${event.k}`);
    }
    this.transport.send({ t: "battleEvent", epoch, wave, turn, seq, event });
  }

  /**
   * HOST: send an out-of-turn authoritative checkpoint (after a switch / capture / resume),
   * stamped with the host's full-state `checksum` for the guest to verify (#633, TRACK-2).
   */
  sendCheckpoint(
    reason: string,
    epoch: number,
    wave: number,
    turn: number,
    checkpoint: CoopBattleCheckpoint,
    checksum: string,
    fullField: CoopFullMonSnapshot[],
    authoritativeState: CoopAuthoritativeBattleStateV1,
  ): void {
    const revision = authoritativeState.tick;
    coopLog(
      "checksum",
      `host SEND battleCheckpoint reason=${reason} e=${epoch} wave=${wave} turn=${turn} rev=${revision} checksum=${checksum}`,
    );
    const envelope: CoopCheckpointEnvelope = {
      reason,
      epoch,
      wave,
      turn,
      revision,
      checkpoint,
      checksum,
      fullField,
      authoritativeState,
    };
    if (!hasCompleteAuthorityCompanions(envelope)) {
      throw new Error(`refusing malformed ${reason} commit e=${epoch} wave=${wave} turn=${turn} rev=${revision}`);
    }
    if (reason === "replacement") {
      // Retain every addressed revision until its exact post-apply checksum ACK.  The map is intentionally
      // not "latest only": simultaneous/future multi-seat replacement transactions can overlap.
      this.retainAndRetryReplacement(envelope);
    }
    this.transport.send({
      t: "battleCheckpoint",
      ...envelope,
    });
  }

  /** GUEST: request the host's retained complete replacement frame after a failed transactional apply. */
  requestReplacementCheckpoint(envelope: CoopCheckpointEnvelope): void {
    this.transport.send({
      t: "requestBattleCheckpoint",
      reason: "replacement",
      epoch: envelope.epoch,
      wave: envelope.wave,
      turn: envelope.turn,
      revision: envelope.revision,
      checkpointTick: envelope.checkpoint.tick as number,
      stateTick: envelope.authoritativeState.tick,
    });
  }

  private sendTurnCommitRequest(request: { epoch: number; wave: number; turn: number; revision?: number }): void {
    this.transport.send({ t: "requestTurnCommit", ...request });
  }

  private clearTurnCommitRequest(key: string): void {
    this.requestedTurnCommits.delete(key);
    this.turnRequestTimers.get(key)?.();
    this.turnRequestTimers.delete(key);
  }

  /** GUEST: keep requesting one exact logical turn until its verified ACK clears the request. */
  requestTurnCommit(epoch: number, wave: number, turn: number, revision?: number): void {
    const key = pendingTurnKey({ epoch, wave, turn });
    const request = { epoch, wave, turn, ...(revision === undefined ? {} : { revision }) };
    this.requestedTurnCommits.set(key, request);
    this.sendTurnCommitRequest(request);
    if (this.turnRequestTimers.has(key)) {
      return;
    }
    const retry = () => {
      const pending = this.requestedTurnCommits.get(key);
      if (pending == null) {
        this.turnRequestTimers.delete(key);
        return;
      }
      this.sendTurnCommitRequest(pending);
      this.turnRequestTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
    };
    this.turnRequestTimers.set(key, this.schedule(retry, AUTHORITY_RETRY_MS));
  }

  onTurnCommit(handler: (resolution: CoopTurnResolution) => void): () => void {
    this.turnCommitHandlers.add(handler);
    return () => this.turnCommitHandlers.delete(handler);
  }

  acknowledgeTurnCommit(resolution: CoopTurnResolution, superseding?: CoopCheckpointEnvelope): void {
    const ack: Extract<CoopMessage, { t: "turnCommitAck" }> = {
      t: "turnCommitAck",
      epoch: resolution.epoch,
      wave: resolution.wave,
      turn: resolution.turn,
      revision: resolution.revision,
      checkpointTick: resolution.checkpoint.tick as number,
      stateTick: resolution.authoritativeState.tick,
      checksum: resolution.checksum,
      status: superseding == null ? "applied" : "superseded",
      ...(superseding == null
        ? {}
        : {
            supersededByRevision: superseding.revision,
            supersededByChecksum: superseding.checksum,
          }),
    };
    const key = authorityKey(resolution);
    rememberBounded(this.ackedTurnCommits, key, ack);
    const inboxKey = pendingTurnKey(resolution);
    if (this.inbox.get(inboxKey)?.revision === resolution.revision) {
      this.inbox.delete(inboxKey);
    }
    const pendingKey = pendingTurnKey(resolution);
    this.clearTurnCommitRequest(pendingKey);
    this.transport.send(ack);
  }

  acknowledgeReplacement(envelope: CoopCheckpointEnvelope): void {
    const ack: Extract<CoopMessage, { t: "battleCheckpointAck" }> = {
      t: "battleCheckpointAck",
      reason: "replacement",
      epoch: envelope.epoch,
      wave: envelope.wave,
      turn: envelope.turn,
      revision: envelope.revision,
      checkpointTick: envelope.checkpoint.tick as number,
      stateTick: envelope.authoritativeState.tick,
      checksum: envelope.checksum,
    };
    rememberBounded(this.ackedReplacementCommits, authorityKey(envelope), ack);
    this.transport.send(ack);
  }

  onAuthorityFailure(handler: (failure: CoopAuthorityFailure) => void): () => void {
    this.authorityFailureHandlers.add(handler);
    return () => this.authorityFailureHandlers.delete(handler);
  }

  consumeAuthorityFailure(): CoopAuthorityFailure | null {
    const failure = this.lastAuthorityFailure;
    this.lastAuthorityFailure = null;
    return failure;
  }

  /** Retain and retry a fatal boundary until the peer acknowledges receipt or the absolute deadline expires. */
  broadcastAuthorityFailure(
    failure: Omit<CoopAuthorityFailure, "t" | "failureId" | "revision"> & {
      failureId?: string;
      revision?: number;
    },
  ): Promise<boolean> {
    if (this.pendingAuthorityFailure != null) {
      return Promise.resolve(false);
    }
    const message: CoopAuthorityFailure = {
      t: "authorityFailure",
      ...failure,
      revision:
        Number.isSafeInteger(failure.revision) && (failure.revision as number) > 0
          ? (failure.revision as number)
          : ++this.authorityFailureRevision,
      failureId:
        failure.failureId
        ?? `${failure.epoch}:${failure.wave}:${failure.turn}:${failure.boundary}:${Date.now().toString(36)}`,
    };
    return new Promise(resolve => {
      const deadline = this.now() + AUTHORITY_FATAL_DEADLINE_MS;
      const send = () => {
        const pending = this.pendingAuthorityFailure;
        if (pending == null || pending.message.failureId !== message.failureId) {
          return;
        }
        this.transport.send(message);
        if (this.now() >= deadline) {
          this.pendingAuthorityFailure = null;
          resolve(false);
          return;
        }
        pending.cancel = this.schedule(send, AUTHORITY_FATAL_RETRY_MS);
      };
      this.pendingAuthorityFailure = { message, deadline, cancel: () => {}, resolve };
      send();
    });
  }

  /**
   * Schedule a replacement-recovery retry through this stream's injected scheduler. Callers still bind
   * the callback to their session generation/runtime before touching engine state; tests can inject a
   * deterministic per-client scheduler without allowing a raw ambient timer to run under another duo ctx.
   */
  scheduleAuthorityRetry(callback: () => void, ms: number): () => void {
    return this.schedule(callback, ms);
  }

  authorityNow(): number {
    return this.now();
  }

  /** HOST: send the authoritative full-state snapshot answering a guest's `requestStateSync`. */
  sendStateSync(blob: string, seq: number): void {
    coopLog("resync", `host SEND stateSync seq=${seq} blobLen=${blob.length}`);
    this.transport.send({ t: "stateSync", blob, seq });
  }

  /** HOST: push the heavy state snapshot selected when the requested journal gap was evicted. */
  sendDurabilitySnapshot(blob: string): void {
    this.sendStateSync(blob, COOP_DURABILITY_SNAPSHOT_SEQ);
  }

  /** GUEST: install the production live apply callback for deep-gap snapshot pushes. */
  onDurabilitySnapshot(handler: (blob: string) => void): void {
    this.durabilitySnapshotHandler = handler;
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
    transition?: CoopWaveAdvancePayload,
  ): void {
    coopLog(
      "replay",
      `host SEND waveResolved wave=${wave} outcome=${outcome} transition=${transition == null ? "legacy" : `${transition.nextLogicalPhase}/next${transition.nextWave}/biome${Number(transition.biomeChange)}/egg${Number(transition.eggLapse)}/${transition.victoryKind ?? "-"}`}${captureParty == null ? "" : ` captureParty=${captureParty.length}`}${capturePresentation == null ? "" : ` cap=sp${capturePresentation.speciesId}`}`,
    );
    this.transport.send({ t: "waveResolved", wave, outcome, captureParty, capturePresentation, transition });
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
   * waits for it to arrive, or resolves `null` on timeout (the authoritative caller fails closed).
   * The guest calls this
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
            `guest awaitEnemyParty wave=${wave} -> null (timeout/superseded), authoritative caller fails closed`,
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
   * waits for the host's PUSH or requests the retained snapshot again, and resolves `null` on timeout
   * so the caller can show explicit recovery. It never falls back to a locally generated launch.
   * Mirrors {@linkcode awaitEnemyParty} exactly. The guest calls
   * this at launch BEFORE building anything, then boots from the snapshot (computing nothing).
   */
  awaitLaunchSnapshot(
    wave: number,
    timeoutMs = this.timeoutMs,
    retry: { retryIntervalMs?: number; maxRetries?: number } = {},
  ): Promise<string | null> {
    if (this.launchSnapshotAbortWaves.delete(wave)) {
      coopWarn("stream", `guest awaitLaunchSnapshot wave=${wave} -> null (buffered host abort)`);
      return Promise.resolve(null);
    }
    // Already buffered for this wave (the host raced ahead) -> consume + return immediately.
    const buffered = this.lastLaunchSnapshot;
    if (buffered != null && buffered.wave === wave) {
      this.lastLaunchSnapshot = null;
      this.consumedLaunchSnapshotWaves.add(wave);
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
      let cancelTimeout: () => void = () => {};
      let cancelRetry: () => void = () => {};
      let retryCount = 0;
      const retryIntervalMs = retry.retryIntervalMs ?? 1_000;
      const maxRetries = retry.maxRetries ?? 12;
      const finish = (res: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimeout();
        cancelRetry();
        if (this.launchSnapshotWaiters.get(wave) === finish) {
          this.launchSnapshotWaiters.delete(wave);
        }
        if (res == null) {
          coopWarn(
            "stream",
            `guest awaitLaunchSnapshot wave=${wave} -> null (timeout/superseded), authoritative caller fails closed`,
          );
        } else {
          coopLog("stream", `guest awaitLaunchSnapshot wave=${wave} RESOLVE len=${res.length}`);
        }
        resolve(res);
      };
      this.launchSnapshotWaiters.set(wave, finish);
      // A reliable ordered channel does not recover a frame lost while no handler/channel existed or a
      // mid-send SCTP abort. Ask the host to replay its retained boundary snapshot after the waiter is
      // parked; the response is idempotent and wave-keyed, so it cannot satisfy another launch.
      coopLog("stream", `guest SEND requestLaunchSnapshot wave=${wave}`);
      this.transport.send({ t: "requestLaunchSnapshot", wave });
      const scheduleRetry = () => {
        if (retryIntervalMs <= 0 || retryCount >= maxRetries) {
          return;
        }
        cancelRetry = this.schedule(() => {
          if (settled) {
            return;
          }
          retryCount++;
          coopWarn(
            "stream",
            `guest awaitLaunchSnapshot wave=${wave} no snapshot yet, RE-REQUEST attempt ${retryCount}/${maxRetries}`,
          );
          this.transport.send({ t: "requestLaunchSnapshot", wave });
          scheduleRetry();
        }, retryIntervalMs);
      };
      scheduleRetry();
      cancelTimeout = this.schedule(() => finish(null), timeoutMs);
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
   * resolves immediately; only the full ceiling with no arrival resolves null (then the authoritative
   * caller fails closed). A pre-await arrival is already BUFFERED by wave
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

    const buffered = this.consumeEnemyParty(wave);
    if (buffered != null) {
      return Promise.resolve(buffered);
    }

    // The single long-lived await is the source of truth + the 120s backstop. We never
    // supersede it on a retry (that would resolve it null); we only re-poke the host.
    const awaited = this.awaitEnemyParty(wave, timeoutMs);
    try {
      sendRequest(wave);
    } catch {
      /* the timed retry remains armed */
    }
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
   * timeout. The waiter immediately requests replay of the host's retained keyed party and repeats
   * that request after reconnect, so a lost first carrier cannot make the guest use a local roll.
   * A null result is teardown/protocol failure and callers must fail closed.
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
            `guest awaitMeBattleEnemyParty key=${key} -> null (timeout/superseded), authoritative caller fails closed`,
          );
        } else {
          coopLog("stream", `guest awaitMeBattleEnemyParty key=${key} RESOLVE count=${res.length}`);
        }
        resolve(res);
      };
      this.meBattlePartyWaiters.set(key, finish);
      coopLog("stream", `guest SEND requestMeBattleEnemyParty key=${key}`);
      this.transport.send({ t: "requestMeBattleEnemyParty", key });
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** GUEST: handle an out-of-turn authoritative checkpoint. */
  onCheckpoint(handler: (reason: string, checkpoint: CoopBattleCheckpoint) => void): void {
    coopLog("stream", `guest REGISTER onCheckpoint handler (was=${this.checkpointHandler != null})`);
    this.checkpointHandler = handler;
  }

  /**
   * GUEST: observe complete out-of-band checkpoint arrivals. Used by a recovery phase that is
   * deliberately holding the phase queue: the normal replay pump cannot consume the checkpoint while
   * that hold is current, so the arrival must be able to wake the safe boundary itself. The observer
   * never consumes or applies the payload; callers must explicitly consume the retained envelope after
   * proving it supersedes the state they are holding on.
   */
  onCheckpointEnvelope(handler: (envelope: CoopCheckpointEnvelope) => void): () => void {
    this.checkpointEnvelopeHandlers.add(handler);
    return () => {
      this.checkpointEnvelopeHandlers.delete(handler);
    };
  }

  /** Deliver an envelope to independent temporary observers without breaking the primary fan-out. */
  private notifyCheckpointEnvelope(envelope: CoopCheckpointEnvelope): void {
    // Copy before invoking: an observer may unsubscribe itself (or end its recovery phase), which
    // must not skip another independent observer in the same delivery.
    for (const handler of [...this.checkpointEnvelopeHandlers]) {
      try {
        handler(envelope);
      } catch (error) {
        // A diagnostic/recovery observer is never allowed to suppress the replay pump wake or the
        // legacy presentation observer for this same authority frame.
        coopWarn("stream", `checkpoint envelope observer threw reason=${envelope.reason} (isolated)`, error);
      }
    }
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
      transition?: CoopWaveAdvancePayload,
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
    const entry = this.currentCheckpointEntry();
    if (entry == null) {
      return null;
    }
    this.pendingCheckpoints.delete(entry[0]);
    return entry[1];
  }

  /** Inspect, but do not consume, the latest authoritative checkpoint envelope. */
  peekCheckpoint(): CoopCheckpointEnvelope | null {
    return this.currentCheckpointEntry()?.[1] ?? null;
  }

  /** Record an out-of-band envelope only after its numeric/full state applied successfully. */
  retainAppliedOutOfBandCheckpoint(checkpoint: CoopCheckpointEnvelope): void {
    const key = pendingTurnKey(checkpoint);
    const previous = this.appliedOutOfBandCheckpoints.get(key);
    if (previous != null && previous.revision >= checkpoint.revision) {
      return;
    }
    this.appliedOutOfBandCheckpoints.delete(key);
    rememberBounded(this.appliedOutOfBandCheckpoints, key, checkpoint);
  }

  /**
   * Take the newer replacement envelope that must be reasserted after delayed turn presentation.
   * Only the same addressed turn or its exact N+1 replacement may supersede a resolution. An older
   * finalizer therefore cannot consume authority that belongs to a later turn before that turn's
   * own finalizer reaches its safe boundary.
   */
  consumeAppliedOutOfBandCheckpoint(
    resolution: Pick<CoopTurnResolution, "epoch" | "wave" | "turn" | "revision">,
  ): CoopCheckpointEnvelope | null {
    if (
      !isSafeAddressPart(resolution.epoch, false)
      || !isSafeAddressPart(resolution.wave, false)
      || !isSafeAddressPart(resolution.turn, false)
      || !isSafeAddressPart(resolution.revision, false)
    ) {
      return null;
    }
    const candidates = [...this.appliedOutOfBandCheckpoints.entries()]
      .filter(
        ([, checkpoint]) =>
          checkpoint.reason === "replacement"
          && checkpoint.epoch === resolution.epoch
          && checkpoint.wave === resolution.wave
          && (checkpoint.turn === resolution.turn || checkpoint.turn === resolution.turn + 1)
          && checkpoint.revision > resolution.revision,
      )
      .sort((left, right) => right[1].revision - left[1].revision);
    const selected = candidates[0];
    if (selected == null) {
      return null;
    }
    this.appliedOutOfBandCheckpoints.delete(selected[0]);
    return selected[1];
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
    const entry = this.liveTurnEntry(turn);
    if (entry == null) {
      coopLog("replay", `guest consume live events turn=${turn} count=0`);
      return [];
    }
    this.liveEvents.delete(entry[0]);
    const consumed = [...entry[1].events.entries()].sort((a, b) => a[0] - b[0]).map(([seq, event]) => ({ seq, event }));
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
    const entry = this.liveTurnEntry(turn);
    if (entry == null) {
      return [];
    }
    const perTurn = entry[1].events;
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
    const waitedAddress = this.currentAuthorityAddress(turn);
    const checkpoint = this.peekCheckpoint();
    if (checkpoint != null && this.checkpointCanWakeTurn(checkpoint, waitedAddress, turn)) {
      return Promise.resolve({ kind: "checkpoint" as const });
    }
    if (this.bufferedTurnEntry(turn) != null) {
      return this.awaitTurn(turn).then(res => ({ kind: "turn" as const, res }));
    }
    const liveEntry = this.liveTurnEntry(turn);
    if (liveEntry != null && liveEntry[1].events.has(fromSeq)) {
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
      const settleLive = (liveAddress: CoopTurnAddress, seq: number) => {
        const matchesWait =
          waitedAddress == null
            ? this.authorityContext == null && liveAddress.turn === turn
            : sameTurnAddress(liveAddress, waitedAddress);
        if (settled || !matchesWait || seq < fromSeq) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ kind: "live" });
      };
      // #633 guest-faint deadlock: an OUT-OF-BAND checkpoint (the host auto-summoned a
      // replacement into the guest-owned slot) must WAKE the parked pump - it carries the
      // mon the guest has to command before the turn resolution can ever arrive.
      const settleCheckpoint = (envelope: CoopCheckpointEnvelope) => {
        if (settled || !this.checkpointCanWakeTurn(envelope, waitedAddress, turn)) {
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
          rememberBounded(this.inbox, pendingTurnKey(res), res);
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
    const lookup = this.turnWaitAddress(turn);
    const pending = this.pending.get(lookup.key);
    if (pending == null) {
      return false;
    }
    coopWarn("replay", `guest awaitTurn turn=${turn} ABORT (phantom turn dissolve #859)`);
    pending.finish(null);
    return true;
  }

  awaitTurn(turn: number): Promise<CoopTurnResolution | null> {
    const lookup = this.turnWaitAddress(turn);
    // Supersede every stale waiter for this numeric turn. Addressed keys prevent it from resolving the
    // new waiter, while actively dissolving it avoids a prior wave's 20-minute timeout firing later.
    for (const [key, stale] of [...this.pending.entries()]) {
      if (key !== lookup.key && stale.turn === turn) {
        coopWarn("stream", `guest awaitTurn turn=${turn} superseding stale addressed waiter key=${key}`);
        stale.finish(null);
        this.clearTurnCommitRequest(key);
      }
    }
    const duplicate = this.pending.get(lookup.key);
    if (duplicate != null) {
      coopWarn("stream", `guest awaitTurn turn=${turn} superseding duplicate addressed waiter`);
      duplicate.finish(null);
    }
    if (lookup.address != null && this.authorityContext != null) {
      this.requestTurnCommit(lookup.address.epoch, lookup.address.wave, lookup.address.turn);
    }
    const bufferedEntry = this.bufferedTurnEntry(turn);
    if (bufferedEntry !== undefined) {
      const [bufferedKey, buffered] = bufferedEntry;
      this.inbox.delete(bufferedKey);
      if (this.authorityContext != null) {
        this.requestTurnCommit(buffered.epoch, buffered.wave, buffered.turn, buffered.revision);
      }
      coopLog("replay", `guest awaitTurn turn=${turn} RESOLVE (buffered race) events=${buffered.events.length}`);
      return Promise.resolve(buffered);
    }
    coopLog("replay", `guest awaitTurn turn=${turn} START timeout=${this.timeoutMs}ms`);
    this.pendingSince.set(lookup.key, Date.now());
    return new Promise<CoopTurnResolution | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopTurnResolution | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(lookup.key)?.finish === finish) {
          this.pending.delete(lookup.key);
          this.pendingSince.delete(lookup.key);
        }
        if (res == null) {
          coopWarn("replay", `guest awaitTurn turn=${turn} STALL -> null (timeout/superseded)`);
        } else {
          if (this.authorityContext != null) {
            this.requestTurnCommit(res.epoch, res.wave, res.turn, res.revision);
          }
          coopLog(
            "replay",
            `guest awaitTurn turn=${turn} RESOLVE events=${res.events.length} checksum=${res.checksum}`,
          );
        }
        resolve(res);
      };
      this.pending.set(lookup.key, { turn, address: lookup.address, finish });
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
    for (const finish of [...this.launchSnapshotWaiters.values()]) {
      finish(null);
    }
    this.stateSyncWaiters.clear();
    this.launchSnapshotWaiters.clear();
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
    this.offStateChange();
    for (const pending of [...this.pending.values()]) {
      pending.finish(null);
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
    this.pendingSince.clear();
    for (const cancel of this.turnRequestTimers.values()) {
      cancel();
    }
    this.turnRequestTimers.clear();
    this.requestedTurnCommits.clear();
    for (const cancel of this.sentTurnCommitTimers.values()) {
      cancel();
    }
    this.sentTurnCommitTimers.clear();
    this.sentTurnCommits.clear();
    this.turnCommitHandlers.clear();
    this.ackedTurnCommits.clear();
    this.enemyPartyWaiters.clear();
    this.meBattlePartyWaiters.clear();
    this.meBattlePartyInbox.clear();
    this.sentMeBattleParties.clear();
    this.stateSyncWaiters.clear();
    this.stateSyncInbox.clear();
    this.inbox.clear();
    this.liveEvents.clear();
    this.finalizedMarks.clear();
    this.liveEventHandler = null;
    this.liveWaiter = null;
    this.pendingCheckpoints.clear();
    for (const cancel of this.sentReplacementTimers.values()) {
      cancel();
    }
    this.sentReplacementTimers.clear();
    this.sentReplacementCheckpoints.clear();
    this.ackedReplacementCommits.clear();
    this.hostAppliedReplacementAcks.clear();
    this.authorityFailureHandlers.clear();
    this.lastAuthorityFailure = null;
    this.ackedAuthorityFailures.clear();
    if (this.pendingAuthorityFailure != null) {
      this.pendingAuthorityFailure.cancel();
      this.pendingAuthorityFailure.resolve(false);
      this.pendingAuthorityFailure = null;
    }
    this.appliedOutOfBandCheckpoints.clear();
    this.lastEnemyParty = null;
    this.sentEnemyParties.clear();
    this.enemyPartyStateByWave.clear();
    this.enemyPartyEncounterByWave.clear();
    this.meTypeByWave.clear();
    this.battleTypeByWave.clear();
    this.lastLaunchSnapshot = null;
    this.lastSentLaunchSnapshot = null;
    this.lastSentLaunchSnapshotAbort = null;
    this.launchSnapshotAbortWaves.clear();
    this.consumedLaunchSnapshotWaves.clear();
    this.enemyPartyHandler = null;
    this.checkpointHandler = null;
    this.checkpointEnvelopeHandlers.clear();
    this.ghostPoolHandler = null;
    this.lastGhostPool = null;
    this.stateSyncRequestHandler = null;
    this.durabilitySnapshotHandler = null;
    this.enemyPartyRequestHandler = null;
    this.meChecksumHandler = null;
    this.meMessageHandler = null;
    this.waveResolvedHandler = null;
    this.waveEndStateHandler = null;
  }

  private handle(msg: CoopMessage): void {
    switch (msg.t) {
      case "enemyPartySync": {
        if (msg.authoritativeState !== undefined) {
          this.enemyPartyStateByWave.set(msg.wave, msg.authoritativeState);
        }
        if (msg.encounter === undefined) {
          // Legacy/unit carriers without the complete descriptor still populate the early hints. The
          // er-coop-21 production adopt refuses to cross the encounter boundary without the descriptor.
          if (msg.meType !== undefined) {
            this.meTypeByWave.set(msg.wave, msg.meType);
          }
          if (msg.battleType !== undefined) {
            this.battleTypeByWave.set(msg.wave, msg.battleType);
          }
        } else {
          this.enemyPartyEncounterByWave.set(msg.wave, msg.encounter);
          this.meTypeByWave.set(msg.wave, msg.encounter.mysteryEncounterType);
          this.battleTypeByWave.set(msg.wave, msg.encounter.battleType);
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
        if (this.consumedLaunchSnapshotWaves.has(msg.wave)) {
          coopLog("replay", `guest IGNORE duplicate launchSnapshot wave=${msg.wave} (already consumed)`);
          return;
        }
        // GUEST: hand the authoritative launch snapshot to a parked awaitLaunchSnapshot (consumed),
        // else buffer it for the next await (the host may race ahead of the guest reaching its await).
        const waiter = this.launchSnapshotWaiters.get(msg.wave);
        coopLog(
          "replay",
          `guest RECV launchSnapshot wave=${msg.wave} sessionLen=${msg.session.length} ${waiter ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (waiter) {
          this.lastLaunchSnapshot = null;
          this.consumedLaunchSnapshotWaves.add(msg.wave);
          waiter(msg.session);
          return;
        }
        this.lastLaunchSnapshot = { wave: msg.wave, session: msg.session };
        return;
      }
      case "launchSnapshotAbort": {
        const waiter = this.launchSnapshotWaiters.get(msg.wave);
        coopWarn("stream", `guest RECV launchSnapshotAbort wave=${msg.wave} reason=${msg.reason}`);
        if (waiter == null) {
          this.launchSnapshotAbortWaves.add(msg.wave);
        } else {
          waiter(null);
        }
        return;
      }
      case "requestLaunchSnapshot": {
        const aborted = this.lastSentLaunchSnapshotAbort;
        if (aborted?.wave === msg.wave) {
          coopWarn(
            "stream",
            `host RECV requestLaunchSnapshot wave=${msg.wave} -> RESEND abort reason=${aborted.reason}`,
          );
          this.transport.send(aborted);
          return;
        }
        const cached = this.lastSentLaunchSnapshot;
        if (cached?.wave !== msg.wave) {
          coopWarn(
            "stream",
            `host RECV requestLaunchSnapshot wave=${msg.wave} -> no matching cache (cached=${cached?.wave ?? "none"})`,
          );
          return;
        }
        coopLog("stream", `host RECV requestLaunchSnapshot wave=${msg.wave} -> RESEND len=${cached.session.length}`);
        this.transport.send({ t: "launchSnapshot", wave: cached.wave, session: cached.session });
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
      case "requestMeBattleEnemyParty": {
        const enemies = this.sentMeBattleParties.get(msg.key);
        if (enemies == null) {
          coopWarn("stream", `host RECV requestMeBattleEnemyParty key=${msg.key} -> no retained party`);
          return;
        }
        coopLog("stream", `host RECV requestMeBattleEnemyParty key=${msg.key} -> RESEND count=${enemies.length}`);
        this.transport.send({ t: "meBattleEnemyPartySync", key: msg.key, enemies });
        return;
      }
      case "turnResolution": {
        if (
          typeof msg.preimage !== "string"
          || msg.preimage.length === 0
          || !Array.isArray(msg.events)
          || !msg.events.every(isStrictBattleEvent)
          || !hasCompleteAuthorityCompanions(msg)
          || !this.acceptsAwaitedTurnAddress(msg)
        ) {
          coopWarn(
            "replay",
            `guest DROP malformed turnResolution turn=${msg.turn} preimage=${typeof msg.preimage === "string"} `
              + `fullField=${Array.isArray(msg.fullField) ? msg.fullField.length : 0} `
              + `state=${msg.authoritativeState == null ? 0 : 1} checksum=${msg.checksum}`,
          );
          return;
        }
        const acked = this.ackedTurnCommits.get(authorityKey(msg));
        if (acked != null) {
          coopLog("replay", `guest RE-ACK duplicate turn commit e=${msg.epoch} wave=${msg.wave} turn=${msg.turn}`);
          this.transport.send(acked);
          return;
        }
        const res: CoopTurnResolution = {
          epoch: msg.epoch,
          wave: msg.wave,
          turn: msg.turn,
          revision: msg.revision,
          events: msg.events,
          checkpoint: msg.checkpoint,
          checksum: msg.checksum,
          preimage: msg.preimage,
          fullField: msg.fullField,
          authoritativeState: msg.authoritativeState,
        };
        const address: CoopTurnAddress = { epoch: msg.epoch, wave: msg.wave, turn: msg.turn };
        const key = pendingTurnKey(address);
        const exactPending = this.pending.get(key);
        const legacyPending = this.authorityContext == null ? this.pending.get(legacyTurnKey(msg.turn)) : undefined;
        const resolver = exactPending ?? legacyPending;
        coopLog(
          "replay",
          `guest RECV turnResolution e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} events=${msg.events.length} `
            + `checksum=${msg.checksum} ${resolver ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (resolver) {
          resolver.finish(res);
        } else {
          // No waiter yet - buffer the latest revision at this exact authority address.
          if (this.inbox.has(key)) {
            coopWarn(
              "stream",
              `guest RECV turnResolution e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} `
                + "superseding earlier buffered revision",
            );
            this.inbox.delete(key);
          }
          rememberBounded(this.inbox, key, res);
        }
        for (const handler of [...this.turnCommitHandlers]) {
          try {
            handler(res);
          } catch (error) {
            coopWarn("stream", `turn commit observer threw turn=${res.turn} (isolated)`, error);
          }
        }
        return;
      }
      case "battleEvent": {
        if (
          !isSafeAddressPart(msg.epoch, false)
          || !isSafeAddressPart(msg.wave, false)
          || !isSafeAddressPart(msg.turn, false)
          || !isSafeAddressPart(msg.seq)
          || !isStrictBattleEvent(msg.event)
          || !this.acceptsCurrentAddress(msg)
        ) {
          coopWarn(
            "replay",
            `guest DROP cross-address/malformed battleEvent e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} seq=${msg.seq}`,
          );
          return;
        }
        // GUEST: buffer the live event by (turn, seq) - de-duped (a re-sent seq overwrites identically)
        // and order-tolerant (the seq, not arrival order, drives replay). Then fire any live handler.
        // HOT PATH (per battle event): build the trace string only when debug is on.
        if (isCoopDebug()) {
          coopLog("replay", `guest RECV live battleEvent turn=${msg.turn} seq=${msg.seq} k=${msg.event.k}`);
        }
        const address: CoopTurnAddress = { epoch: msg.epoch, wave: msg.wave, turn: msg.turn };
        const key = pendingTurnKey(address);
        let perTurn = this.liveEvents.get(key);
        if (perTurn == null) {
          perTurn = { address, events: new Map<number, CoopBattleEvent>() };
          rememberBounded(this.liveEvents, key, perTurn);
          while (this.liveEvents.size > LIVE_EVENT_TURN_RETENTION + 1) {
            const oldest = this.liveEvents.keys().next().value as string | undefined;
            if (oldest === undefined) {
              break;
            }
            this.liveEvents.delete(oldest);
          }
        }
        perTurn.events.set(msg.seq, msg.event);
        this.liveEventHandler?.(msg.turn, msg.seq, msg.event);
        this.liveWaiter?.(address, msg.seq);
        return;
      }
      case "battleCheckpoint": {
        if (!hasCompleteAuthorityCompanions(msg) || !this.acceptsCurrentAddress(msg)) {
          coopWarn(
            "checkpoint",
            `guest DROP malformed battleCheckpoint reason=${msg.reason} `
              + `fullField=${Array.isArray(msg.fullField) ? msg.fullField.length : 0} `
              + `state=${msg.authoritativeState == null ? 0 : 1} checksum=${msg.checksum}`,
          );
          return;
        }
        const acked = this.ackedReplacementCommits.get(authorityKey(msg));
        if (acked != null) {
          coopLog(
            "checkpoint",
            `guest RE-ACK duplicate replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          this.transport.send(acked);
          return;
        }
        const key = pendingTurnKey(msg);
        const buffered = this.pendingCheckpoints.get(key);
        if (buffered != null && buffered.revision > msg.revision) {
          coopWarn(
            "checkpoint",
            `guest DROP out-of-order checkpoint rev=${msg.revision} behind buffered=${buffered.revision}`,
          );
          return;
        }
        // Buffer for the guest's next consumeCheckpoint() (applied at a turn boundary),
        // carrying the host's checksum so the guest can verify convergence after applying.
        coopLog("checksum", `guest RECV battleCheckpoint reason=${msg.reason} checksum=${msg.checksum}`);
        const envelope: CoopCheckpointEnvelope = {
          reason: msg.reason,
          epoch: msg.epoch,
          wave: msg.wave,
          turn: msg.turn,
          revision: msg.revision,
          checkpoint: msg.checkpoint,
          checksum: msg.checksum,
          fullField: msg.fullField,
          authoritativeState: msg.authoritativeState,
        };
        this.pendingCheckpoints.delete(key);
        rememberBounded(this.pendingCheckpoints, key, envelope);
        this.notifyCheckpointEnvelope(envelope);
        this.checkpointWaiter?.(envelope);
        this.checkpointHandler?.(msg.reason, msg.checkpoint);
        return;
      }
      case "requestTurnCommit": {
        if (
          !isSafeAddressPart(msg.epoch, false)
          || !isSafeAddressPart(msg.wave, false)
          || !isSafeAddressPart(msg.turn, false)
          || (msg.revision !== undefined && !isSafeAddressPart(msg.revision, false))
          || !this.acceptsCurrentAddress(msg, false)
        ) {
          coopWarn("stream", `host DROP malformed/cross-session turn request ${JSON.stringify(msg)}`);
          return;
        }
        const retained = [...this.sentTurnCommits.values()]
          .filter(
            commit =>
              commit.epoch === msg.epoch
              && commit.wave === msg.wave
              && commit.turn === msg.turn
              && (msg.revision === undefined || commit.revision === msg.revision),
          )
          .sort((a, b) => b.revision - a.revision)[0];
        if (retained == null) {
          this.transport.send({
            t: "turnCommitPending",
            epoch: msg.epoch,
            wave: msg.wave,
            turn: msg.turn,
          });
          return;
        }
        this.transport.send(retained);
        return;
      }
      case "turnCommitPending": {
        if (!this.acceptsAwaitedTurnAddress(msg)) {
          coopWarn(
            "stream",
            `guest DROP cross-address turnCommitPending e=${msg.epoch} wave=${msg.wave} turn=${msg.turn}`,
          );
          return;
        }
        coopLog("stream", `guest host-liveness pending turn commit e=${msg.epoch} wave=${msg.wave} turn=${msg.turn}`);
        return;
      }
      case "turnCommitAck": {
        const retained = this.sentTurnCommits.get(authorityKey(msg));
        const supersedingAck =
          msg.status === "superseded"
            ? [...this.hostAppliedReplacementAcks.values()].find(
                // Replacement authority is normally captured after TurnEnd opens N+1, so its exact
                // converged ACK may prove a delayed N commit superseded. Same-turn recovery is also valid;
                // anything beyond the immediate successor is unrelated and cannot clear it.
                ack =>
                  ack.epoch === msg.epoch
                  && ack.wave === msg.wave
                  && (ack.turn === msg.turn || ack.turn === msg.turn + 1)
                  && ack.revision === msg.supersededByRevision
                  && ack.checksum === msg.supersededByChecksum
                  && ack.revision > msg.revision,
              )
            : undefined;
        if (
          retained == null
          || retained.checkpoint.tick !== msg.checkpointTick
          || retained.authoritativeState.tick !== msg.stateTick
          || retained.checksum !== msg.checksum
          || (msg.status !== "applied" && msg.status !== "superseded")
          || (msg.status === "superseded" && supersedingAck == null)
        ) {
          coopWarn(
            "stream",
            `host REFUSE mismatched turn ACK e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        const key = authorityKey(msg);
        this.sentTurnCommits.delete(key);
        this.sentTurnCommitTimers.get(key)?.();
        this.sentTurnCommitTimers.delete(key);
        return;
      }
      case "requestBattleCheckpoint": {
        const retained = this.sentReplacementCheckpoints.get(authorityKey(msg));
        if (
          msg.reason !== "replacement"
          || retained == null
          || !sameAuthorityAddress(msg, retained)
          || msg.checkpointTick !== retained.checkpoint.tick
          || msg.stateTick !== retained.authoritativeState.tick
        ) {
          coopWarn(
            "checkpoint",
            `host cannot satisfy replacement retransmit request checkpointTick=${msg.checkpointTick} `
              + `stateTick=${msg.stateTick} retained=${retained == null ? 0 : 1}`,
          );
          return;
        }
        coopLog(
          "checkpoint",
          `host RE-SEND retained replacement checkpointTick=${retained.checkpoint.tick ?? "legacy"} `
            + `stateTick=${retained.authoritativeState.tick} requested=${msg.checkpointTick}/${msg.stateTick}`,
        );
        this.transport.send({
          t: "battleCheckpoint",
          ...retained,
        });
        return;
      }
      case "battleCheckpointAck": {
        const key = authorityKey(msg);
        const retained = this.sentReplacementCheckpoints.get(key);
        if (
          retained == null
          || msg.reason !== "replacement"
          || !sameAuthorityAddress(msg, retained)
          || msg.checkpointTick !== retained.checkpoint.tick
          || msg.stateTick !== retained.authoritativeState.tick
          || msg.checksum !== retained.checksum
        ) {
          coopWarn(
            "checkpoint",
            `host REFUSE mismatched replacement ACK e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        rememberBounded(this.hostAppliedReplacementAcks, key, msg);
        this.sentReplacementCheckpoints.delete(key);
        this.sentReplacementTimers.get(key)?.();
        this.sentReplacementTimers.delete(key);
        return;
      }
      case "authorityFailure": {
        if (
          typeof msg.failureId !== "string"
          || msg.failureId.length === 0
          || typeof msg.reason !== "string"
          || msg.reason.length === 0
          || !isSafeAddressPart(msg.epoch, false)
          || !isSafeAddressPart(msg.wave, false)
          || !isSafeAddressPart(msg.turn, false)
          || !isSafeAddressPart(msg.revision, false)
          || (msg.boundary !== "turnResolution" && msg.boundary !== "replacement")
          || !this.acceptsCurrentAddress(msg)
        ) {
          coopWarn("stream", `DROP malformed/cross-address authorityFailure id=${msg.failureId}`);
          return;
        }
        const failureKey = authorityFailureKey(msg);
        const priorAck = this.ackedAuthorityFailures.get(failureKey);
        if (priorAck != null) {
          this.transport.send(priorAck);
          return;
        }
        const ack: Extract<CoopMessage, { t: "authorityFailureAck" }> = {
          t: "authorityFailureAck",
          failureId: msg.failureId,
          epoch: msg.epoch,
          wave: msg.wave,
          turn: msg.turn,
          revision: msg.revision,
          boundary: msg.boundary,
        };
        rememberBounded(this.ackedAuthorityFailures, failureKey, ack);
        this.transport.send(ack);
        this.lastAuthorityFailure = msg;
        for (const handler of [...this.authorityFailureHandlers]) {
          try {
            handler(msg);
          } catch (error) {
            coopWarn("stream", `authority failure observer threw id=${msg.failureId} (isolated)`, error);
          }
        }
        for (const pending of [...this.pending.values()]) {
          pending.finish(null);
        }
        return;
      }
      case "authorityFailureAck": {
        const pending = this.pendingAuthorityFailure;
        if (
          pending == null
          || pending.message.failureId !== msg.failureId
          || pending.message.epoch !== msg.epoch
          || pending.message.wave !== msg.wave
          || pending.message.turn !== msg.turn
          || pending.message.revision !== msg.revision
          || pending.message.boundary !== msg.boundary
        ) {
          return;
        }
        pending.cancel();
        this.pendingAuthorityFailure = null;
        pending.resolve(true);
        return;
      }
      case "requestEnemyParty": {
        // HOST: the guest re-requested its enemy party (its original sync was lost, or it
        // reached the await before the host generated). Hand it to the host's re-broadcaster
        // (a no-op before the host has the party for that wave).
        coopLog("stream", `host RECV requestEnemyParty wave=${msg.wave}`);
        const retained = this.sentEnemyParties.get(msg.wave);
        if (retained != null) {
          coopLog("stream", `host REPLAY retained enemyPartySync wave=${msg.wave} count=${retained.enemies.length}`);
          this.transport.send(retained);
          return;
        }
        if (this.enemyPartyRequestHandler == null) {
          coopWarn("stream", `host RECV requestEnemyParty wave=${msg.wave} DROPPED (no handler registered)`);
        }
        this.enemyPartyRequestHandler?.(msg.wave);
        return;
      }
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
        if (msg.seq === COOP_DURABILITY_SNAPSHOT_SEQ) {
          coopLog("resync", `guest RECV durability snapshot blobLen=${msg.blob.length} -> live apply`);
          this.durabilitySnapshotHandler?.(msg.blob);
          return;
        }
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
          `guest RECV waveResolved wave=${msg.wave} outcome=${msg.outcome} transition=${msg.transition == null ? "legacy" : `${msg.transition.nextLogicalPhase}/next${msg.transition.nextWave}/biome${Number(msg.transition.biomeChange)}/egg${Number(msg.transition.eggLapse)}/${msg.transition.victoryKind ?? "-"}`}${msg.captureParty == null ? "" : ` captureParty=${msg.captureParty.length}`}${msg.capturePresentation == null ? "" : ` cap=sp${msg.capturePresentation.speciesId}`}`,
        );
        if (this.waveResolvedHandler == null) {
          coopWarn("replay", `guest RECV waveResolved wave=${msg.wave} DROPPED (no handler registered)`);
        }
        this.waveResolvedHandler?.(msg.wave, msg.outcome, msg.captureParty, msg.capturePresentation, msg.transition);
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

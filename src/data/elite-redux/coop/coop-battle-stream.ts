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

import type { TurnResolutionImage } from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import {
  resolveCoopV2CommandFrontier,
  resolveCoopV2ReplacementControl,
} from "#data/elite-redux/coop/authority-v2/command-frontier";
import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import {
  activeCoopReplacementAuthorityMode,
  suppressesLegacyReplacementAckProgression,
  suppressesLegacyReplacementRequest,
} from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import {
  activeCoopTurnAuthorityMode,
  getActiveCoopV2TurnCutover,
  isCoopV2TurnCutoverActive,
  suppressesLegacyTurnAckProgression,
  suppressesLegacyTurnApplication,
} from "#data/elite-redux/coop/authority-v2/cutover-turn";
import {
  type CoopV2ShadowTurnTap,
  isCoopV2ShadowActive,
  tapCoopV2ShadowTurnCommit,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { COOP_CHECKSUM_SENTINEL, canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopFrameContextV1 } from "#data/elite-redux/coop/coop-session-binding";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopAuthorityAckStage,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopCapturePresentation,
  CoopConnectionState,
  CoopEncounterAuthority,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopLaunchSnapshotAbortReason,
  CoopMessage,
  CoopRecoveryAdmissionV1,
  CoopRecoveryCaptureV1,
  CoopRecoveryFrontierV1,
  CoopRecoveryReason,
  CoopRecoveryTicketV1,
  CoopSerializedEnemy,
  CoopStateSyncUnavailableReason,
  CoopSwitchPresentation,
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
  /**
   * Authority V2's canonical successor for this exact TURN_COMMIT.
   *
   * `undefined` means the resolution arrived through the legacy compatibility carrier. `null` is a
   * meaningful V2 statement: this turn has no immediate command successor, so the renderer must wait for
   * the following ordered replacement/wave/interaction entry instead of deriving a phantom CommandPhase.
   */
  authorityNextControl?: CoopNextControl;
  /**
   * Authority V2's global log revision for this exact TURN_COMMIT.
   *
   * This is intentionally distinct from `revision`, which is the legacy turn-carrier schema revision.
   * Successor ordering must use this single V2 ordering domain and must never compare against the carrier
   * revision (for example, first TURN log revision 1 followed by WAVE revision 2 while carrier revision is 3).
   */
  authorityRevision?: number;
}

/** Authority-observed battle classification needed to state the final turn's closed V2 successor. */
export interface CoopTurnBoundaryIdentity {
  /** True only for a battle spawned inside a retained Mystery encounter transaction. */
  readonly mysteryBattle: boolean;
  /**
   * A normal victory already staged by the runtime while this material turn was still recording.
   *
   * This is stronger evidence than the captured party/field image: a double battle can transiently retain
   * one apparently-living enemy seat after VictoryPhase has already selected the win branch. In that case
   * re-deriving the successor from the image opens a phantom COMMAND_FRONTIER and the log correctly refuses
   * the real WAVE_ADVANCE. Only the runtime that owns the staged transition may set this marker.
   */
  readonly deferredWaveOutcome?: "win";
}

/** Complete pre-command cosmetic prefix paired with the post-summon state image that authored it. */
export interface CoopEntryPresentationPrefix {
  readonly events: readonly CoopBattleEvent[];
  readonly stateTick: number;
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
  /** Local-only Authority V2 successor carried beside (never inside) the immutable compatibility image. */
  authorityNextControl?: CoopNextControl;
  /** Global V2 revision paired with {@link authorityNextControl}. */
  authorityRevision?: number;
  /** Local-only immutable V2 summon event; excluded from legacy carrier identity/ACK canonicalization. */
  replacementPresentation?: CoopSwitchPresentation | null;
}

/**
 * Return the immutable compatibility image whose identity is admitted by the stream.
 *
 * Authority V2 projection metadata is deliberately local-only.  It must reach the
 * renderer, but it must never change the canonical identity of the legacy carrier
 * that the ACK/finalization ledger already admitted.
 */
function mechanicalCheckpointEnvelope(envelope: CoopCheckpointEnvelope): CoopCheckpointEnvelope {
  return {
    reason: envelope.reason,
    epoch: envelope.epoch,
    wave: envelope.wave,
    turn: envelope.turn,
    revision: envelope.revision,
    checkpoint: envelope.checkpoint,
    checksum: envelope.checksum,
    fullField: envelope.fullField,
    authoritativeState: envelope.authoritativeState,
  };
}

/** Options for {@linkcode CoopBattleStreamer} (timer injection for tests). */
export interface CoopBattleStreamerOptions {
  /** How long the guest waits for a turn's resolution before giving up. Default 60s. */
  timeoutMs?: number;
  /** Short deadline for an exact state-recovery round trip; never inherit the human-input wait. */
  recoveryTimeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
  /** Clock paired with the injected scheduler so absolute retry deadlines stay deterministic in tests. */
  now?: () => number;
  /** Production address source used to reject cross-session/wave traffic before buffering it. */
  authorityContext?: () => { epoch: number; wave: number; turn: number };
  /** Exact local P33 frame binding used by protocol-38 recovery traffic. */
  recoveryBinding?: () => CoopFrameContextV1 | null;
  /** Authenticate a recovery frame as the current peer seat and channel generation. */
  validatePeerRecoveryBinding?: (binding: CoopFrameContextV1) => boolean;
  /** Absolute retention window for an unacknowledged authority commit. */
  authorityRetentionMs?: number;
  /** Maximum simultaneous retained authority commits before shared play terminates fail-closed. */
  authorityRetentionLimit?: number;
  /** Production terminal hook, invoked only after the peer-ACKed fatal contract reaches an outcome. */
  onAuthorityTerminal?: (reason: string) => void;
  /** Runtime-owned fail-closed hook for a recovery carrier that cannot reach its receiver. */
  onRecoveryTerminal?: (reason: string) => void;
}

export type CoopAuthorityFailure = Extract<CoopMessage, { t: "authorityFailure" }>;

const AUTHORITY_RETRY_MS = 2_000;
const AUTHORITY_FATAL_RETRY_MS = 500;
const AUTHORITY_FATAL_DEADLINE_MS = 3_000;
const AUTHORITY_ACK_RETENTION = 32;
const AUTHORITY_COMMIT_RETENTION = 64;
const AUTHORITY_RETIRED_REPLACEMENT_RETENTION = AUTHORITY_COMMIT_RETENTION;
// Longer than the 120s hot-rejoin grace, but finite: a reconnect gets its full recovery window before
// unacknowledged gameplay authority transitions both peers into the shared terminal.
const AUTHORITY_COMMIT_RETENTION_MS = 150_000;

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

function rememberBoundedValue<T>(set: Set<T>, value: T): void {
  // Refresh insertion order as well as membership: a recently re-proven identity
  // is the last one that should be evicted from the duplicate/redelivery window.
  set.delete(value);
  set.add(value);
  while (set.size > AUTHORITY_ACK_RETENTION) {
    const oldest = set.values().next().value as T | undefined;
    if (oldest === undefined) {
      break;
    }
    set.delete(oldest);
  }
}

function isSafeAddressPart(value: unknown, allowZero = true): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidBattlerIndex(value: unknown): value is number {
  // Protocol 33 supports the current single/double/triple topology and leaves room for six seats per side.
  // A future topology protocol replaces this conservative ceiling with the negotiated manifest.
  return isSafeAddressPart(value) && value <= 11;
}

function isValidPartySlot(value: unknown): value is number {
  return isSafeAddressPart(value) && value <= 5;
}

function isPositiveSafeAddressPart(value: unknown): value is number {
  return isSafeAddressPart(value) && value > 0;
}

/** Hard bound for the summon/on-entry cosmetic prefix retained beside one wave-start state. */
const MAX_ENTRY_PRESENTATION_EVENTS = 256;
/** Defensive ceiling for ER innate plus shared GIFT ability-source indexes. */
const MAX_ABILITY_SOURCE_SLOT = 31;

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
    // BattlerTagType is a string enum at runtime. The frozen historical type says `number[]`, but no
    // numeric-to-enum mapping ever existed; admitting numbers would produce a carrier that cannot converge.
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
      || !Array.isArray(mon.tags)
      || !mon.tags.every(tag => typeof tag === "string" && tag.length > 0)
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
    case "showAbility":
      return (
        isValidBattlerIndex(event.bi)
        && isPositiveSafeAddressPart(event.pokemonId)
        && isValidPartySlot(event.partySlot)
        && isPositiveSafeAddressPart(event.abilityId)
        && typeof event.passive === "boolean"
        && isSafeAddressPart(event.passiveSlot)
        && event.passiveSlot <= MAX_ABILITY_SOURCE_SLOT
      );
    case "weather":
      return (
        isSafeAddressPart(event.weather)
        && isSafeAddressPart(event.turnsLeft)
        && (event.anim === undefined || isSafeAddressPart(event.anim))
      );
    case "terrain":
      return (
        isSafeAddressPart(event.terrain)
        && isSafeAddressPart(event.turnsLeft)
        && (event.anim === undefined || isSafeAddressPart(event.anim))
      );
    case "switch":
      return (
        isValidBattlerIndex(event.bi)
        && isValidPartySlot(event.partySlot)
        && isPositiveSafeAddressPart(event.pokemonId)
        && isPositiveSafeAddressPart(event.speciesId)
        && isSafeAddressPart(event.switchType)
        && typeof event.doReturn === "boolean"
      );
    default:
      return false;
  }
}

function isStrictEntryPresentation(value: unknown): value is CoopBattleEvent[] {
  return Array.isArray(value) && value.length <= MAX_ENTRY_PRESENTATION_EVENTS && value.every(isStrictBattleEvent);
}

function isStrictAuthoritativeState(
  value: unknown,
  allowEmptyEnemyParty = false,
): value is CoopAuthoritativeBattleStateV1 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const state = value as CoopAuthoritativeBattleStateV1;
  const playerPartyValid =
    Array.isArray(state.playerParty)
    && state.playerParty.length > 0
    && state.playerParty.every(mon => mon != null && typeof mon === "object" && isSafeAddressPart(mon.id));
  const enemyPartyValid =
    Array.isArray(state.enemyParty)
    && (allowEmptyEnemyParty || state.enemyParty.length > 0)
    && state.enemyParty.every(mon => mon != null && typeof mon === "object" && isSafeAddressPart(mon.id));
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
    && playerPartyValid
    && enemyPartyValid
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

function authoritativeSeatHp(
  state: CoopAuthoritativeBattleStateV1,
  seat: CoopAuthoritativeBattleStateV1["field"][number],
): number | null {
  const party = seat.side === "player" ? state.playerParty : state.enemyParty;
  const hp = party[seat.partyIndex]?.hp;
  return typeof hp === "number" && Number.isFinite(hp) ? hp : null;
}

function authoritativePartyIsDefeated(party: readonly Record<string, unknown>[]): boolean {
  return party.length > 0 && party.every(mon => typeof mon.hp === "number" && Number.isFinite(mon.hp) && mon.hp <= 0);
}

/**
 * Whether a just-fainted field seat on `side` will be REFILLED by a replacement, mirroring the engine's own
 * enemy/player send decision ({@link FaintPhase}): a replacement occurs iff a LIVING party member exists that
 * is NOT already occupying a field seat (a reserve `getNextSummonIndex` would summon). This is what actually
 * distinguishes a WILD co-faint from a TRAINER co-faint on the authoritative image: a WILD battle's enemyParty
 * holds only its on-field mons (no reserve), so a fainted wild enemy seat crosses NO replacement and the next
 * real successor is the command frontier; a TRAINER (or player bench) keeps a living off-field reserve that
 * WILL refill the seat, which is a replacement boundary. Battle-type is not carried on the authoritative state,
 * but "a living off-field party member on this side" is the exact input the engine's replacement decision reads,
 * so classifying by reserve presence agrees with the engine on both sides without inspecting battleType.
 *
 * A mon whose hp is a non-finite/unknown legacy shape is NOT counted as a living reserve (it stays on the
 * legacy-compatible command path, matching the seat-HP fail-open below).
 */
function sideHasLivingOffFieldReserve(
  state: CoopAuthoritativeBattleStateV1,
  side: CoopAuthoritativeBattleStateV1["field"][number]["side"],
): boolean {
  const party = side === "player" ? state.playerParty : state.enemyParty;
  const onFieldPartyIndices = new Set(state.field.filter(seat => seat.side === side).map(seat => seat.partyIndex));
  return party.some(
    (mon, index) =>
      !onFieldPartyIndices.has(index) && typeof mon.hp === "number" && Number.isFinite(mon.hp) && mon.hp > 0,
  );
}

/**
 * Whether a settled turn can truthfully state an immediate COMMAND successor.
 *
 * A living player mon is not sufficient: victory/defeat crosses into wave or
 * terminal progression, while any just-fainted active seat crosses through a
 * REPLACEMENT authority entry first. The authoritative state deliberately keeps
 * just-fainted occupants in `field`, so the party HP image can distinguish those
 * boundaries without inspecting a mutable phase-name queue. Unknown legacy HP
 * shapes fail open to the legacy-compatible command path; complete V2 carriers
 * always contain PokemonData HP.
 */
export function hasCoopV2ImmediateCommandSuccessor(state: CoopAuthoritativeBattleStateV1): boolean {
  // An immediate COMMAND frontier is only meaningful against a LIVING enemy to command. A complete V2
  // carrier whose enemy party is EMPTY has already crossed a victory/wave boundary - the enemies were
  // defeated AND cleared this turn (an automatic win, incl. a same-turn faint+replacement), and its only
  // legal successor is WAVE_ADVANCE, never a TURN_COMMIT. Without this, a post-summon replacement carrier
  // whose fainted enemy field seats no longer resolve to a party entry (authoritativeSeatHp -> null) slips
  // BOTH the party-defeated check (length-0 guard below) and the fainted-field-seat check, wrongly stating a
  // COMMAND_FRONTIER successor; the log then refuses the victory's WAVE_ADVANCE (fail-closed) and terminates
  // the shared session. The retained "pre-encounter replacement" image (empty enemyParty + player-only field,
  // applied at the next wave's NewBattlePhase) is this SAME carrier and equally wants a terminal successor -
  // the following wave's TURN_COMMIT is authorized by that wave's own control, not by this replacement.
  // (A NON-empty enemy party whose mons lack PokemonData HP is a legacy/unknown shape and still fails OPEN.)
  if (state.enemyParty.length === 0) {
    return false;
  }
  if (authoritativePartyIsDefeated(state.playerParty) || authoritativePartyIsDefeated(state.enemyParty)) {
    return false;
  }
  return !state.field.some(seat => {
    const hp = authoritativeSeatHp(state, seat);
    // A living (or unknown-shape) seat crosses no boundary. A just-fainted seat only crosses a REPLACEMENT
    // boundary when its side will actually refill it - a living off-field reserve exists (trainer enemy /
    // player bench). A WILD co-fainted enemy seat (or any side with no reserve) is refilled by nothing, so
    // the next real successor is the command frontier and must NOT be classified as a gated replacement.
    return hp != null && hp <= 0 && sideHasLivingOffFieldReserve(state, seat.side);
  });
}

/** Exact ordered successor for a normal victory staged before its material turn commit. */
export function deferredCoopV2WaveSuccessorWait(
  operationId: string,
  epoch: number,
  wave: number,
  turn: number,
  boundary: CoopTurnBoundaryIdentity,
): Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }> | null {
  if (boundary.deferredWaveOutcome == null) {
    return null;
  }
  if (boundary.mysteryBattle) {
    throw new Error("a Mystery battle cannot also stage a normal deferred wave victory");
  }
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId: operationId,
    epoch,
    wave,
    // BattleEnd freezes the automatic-victory settlement at exactly the resolving turn + 1.
    turn: turn + 1,
    allowedKinds: ["WAVE_ADVANCE"],
    allowNextWaveStart: false,
    expectedOperationId: null,
  };
}

function hasCompleteAuthorityCompanions(
  msg: Pick<
    CoopCheckpointEnvelope,
    "epoch" | "wave" | "turn" | "revision" | "checkpoint" | "checksum" | "fullField" | "authoritativeState"
  > & { reason?: unknown },
): boolean {
  const state = msg.authoritativeState;
  // A retained faint-switch may materialize at NewBattlePhase before that wave's enemy party exists.
  // That is a complete automatic replacement boundary, not a partial carrier: the authoritative field
  // contains only player seats and all three field companions still match exactly. Keep ordinary turn
  // commits and every replacement with an enemy seat fail-closed on an empty enemy party.
  const isPreEncounterReplacement =
    msg.reason === "replacement"
    && state != null
    && typeof state === "object"
    && Array.isArray(state.enemyParty)
    && state.enemyParty.length === 0
    && Array.isArray(state.field)
    && state.field.length > 0
    && state.field.every(seat => seat?.side === "player");
  if (
    !isSafeAddressPart(msg.epoch, false)
    || !isSafeAddressPart(msg.wave, false)
    || !isSafeAddressPart(msg.turn, false)
    || !isSafeAddressPart(msg.revision, false)
    || !isStrictChecksum(msg.checksum)
    || !isStrictCheckpoint(msg.checkpoint)
    || !isStrictFullField(msg.fullField)
    || !isStrictAuthoritativeState(state, isPreEncounterReplacement)
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
/** Recovery is machine-to-machine and must fail closed quickly, unlike a human command/shop wait. */
export const COOP_STATE_SYNC_RECOVERY_TIMEOUT_MS = 12_000;

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

function authorityKey(address: { epoch: number; wave: number; turn: number; revision: number }): string {
  return `${address.epoch}:${address.wave}:${address.turn}:${address.revision}`;
}

type BufferedAuthorityClass = "turnResolution" | "replacement";

/**
 * Receiver delivery buffers are deliberately namespaced by message class as well as the complete immutable
 * wire address. Turn and replacement commits can legitimately share every numeric address component; they
 * are independent transactions and must never overwrite or satisfy one another.
 */
function bufferedAuthorityKey(
  boundary: BufferedAuthorityClass,
  address: { epoch: number; wave: number; turn: number; revision: number },
): string {
  return `${boundary}:${authorityKey(address)}`;
}

function pendingTurnKey(address: { epoch: number; wave: number; turn: number }): string {
  return `${address.epoch}:${address.wave}:${address.turn}`;
}

type TurnCommitRequest = { epoch: number; wave: number; turn: number; revision?: number };

/**
 * A revisionless request asks for the newest commit at one logical turn. Once a concrete revision is
 * known, its retry lifecycle is an independent immutable transaction and must not share a timer slot
 * with another revision at the same epoch/wave/turn.
 */
function turnCommitRequestKey(request: TurnCommitRequest): string {
  return request.revision === undefined
    ? `latest:${pendingTurnKey(request)}`
    : `exact:${authorityKey({ ...request, revision: request.revision })}`;
}

interface CoopTurnAddress {
  epoch: number;
  wave: number;
  turn: number;
}

interface PendingTurnWaiter {
  turn: number;
  address: CoopTurnAddress | null;
  promise: Promise<CoopTurnResolution | null>;
  finish: (res: CoopTurnResolution | null) => void;
}

interface PendingStateSyncWaiter {
  ticket: CoopRecoveryTicketV1;
  finish: (outcome: CoopStateSyncOutcome) => void;
}

export interface CoopStateSyncResult {
  kind: "snapshot";
  blob: string;
  admission: CoopRecoveryAdmissionV1;
}

export type CoopStateSyncFailure =
  | { kind: "superseded" }
  | { kind: "unavailable" }
  | { kind: "timeout" }
  | { kind: "reconnect-cancelled" };

/** Every recovery request resolves finitely and explicitly; null never grants implicit continuation. */
export type CoopStateSyncOutcome = CoopStateSyncResult | CoopStateSyncFailure;

export interface CoopRecoveryCaptureInput {
  wave: number;
  turn: number;
  stateTick: number;
  controlDigest: string;
}

interface LiveTurnBuffer {
  address: CoopTurnAddress;
  events: Map<number, CoopBattleEvent>;
}

interface SeenAuthority<T> {
  revision: number;
  canonical: string;
  /** Private immutable ledger copy. Never hand this reference to an engine/renderer consumer. */
  value: T;
}

interface AckEvidence<T> {
  stage: CoopAuthorityAckStage;
  canonical: string;
  value: T;
}

interface ReplacementAckIdentity {
  epoch: number;
  wave: number;
  turn: number;
  revision: number;
  checkpointTick: number;
  stateTick: number;
  checksum: string;
}

export type CoopAuthorityContinuationSurface = "command" | "rendererWait" | "sharedInput" | "terminal";

export type CoopAuthorityContinuationExpectation =
  | { kind: "command"; epoch: number; wave: number; turn: number }
  | { kind: "sharedBoundary"; epoch: number; wave: number; turn: number };

interface PendingTurnContinuation {
  resolution: CoopTurnResolution;
  superseding?: CoopCheckpointEnvelope;
  expectation: CoopAuthorityContinuationExpectation;
}

interface PendingReplacementContinuation {
  envelope: CoopCheckpointEnvelope;
  expectation: CoopAuthorityContinuationExpectation;
}

type AuthorityAdmission<T> =
  | { kind: "new"; seen: SeenAuthority<T> }
  | { kind: "older" }
  | { kind: "identical"; seen: SeenAuthority<T> }
  | { kind: "conflict" };

const AUTHORITY_ACK_STAGE_ORDER: Readonly<Record<CoopAuthorityAckStage, number>> = {
  materialApplied: 0,
  presentationReady: 1,
  continuationReady: 2,
};

function isAuthorityAckStage(value: unknown): value is CoopAuthorityAckStage {
  return value === "materialApplied" || value === "presentationReady" || value === "continuationReady";
}

function classifyAckProgress<T>(
  prior: AckEvidence<T> | undefined,
  stage: CoopAuthorityAckStage,
  canonical: string,
): "advance" | "duplicate" | "invalid" {
  if (prior == null) {
    return stage === "materialApplied" ? "advance" : "invalid";
  }
  if (stage === prior.stage) {
    return canonical === prior.canonical ? "duplicate" : "invalid";
  }
  const nextOrder = AUTHORITY_ACK_STAGE_ORDER[stage];
  const priorOrder = AUTHORITY_ACK_STAGE_ORDER[prior.stage];
  if (nextOrder < priorOrder) {
    // ACK evidence rides an at-least-once transport and the renderer may also revisit an exact
    // already-applied phase while a later stage is settling. Once the immutable address, material
    // identity, and supersession tuple have passed the caller's checks, an older stage contains no
    // new claim and cannot roll progression back. Treat it as stale duplicate evidence. Fatalizing
    // this ordinary reordering tore down healthy V2 sessions when materialApplied was replayed after
    // presentationReady; skipped FORWARD stages and same-stage conflicting bytes remain invalid.
    return "duplicate";
  }
  return nextOrder === priorOrder + 1 ? "advance" : "invalid";
}

/** Rehydrate a disposable JSON wire value from the immutable canonical admission bytes. */
function copyAdmittedAuthority<T>(seen: SeenAuthority<T>): T {
  return structuredClone(seen.value);
}

/**
 * ACKs commit the immutable wire identity, not the renderer's working copy. Engine appliers are allowed to
 * normalize/mutate nested arrays while materializing them; those mutations must never turn a valid admitted
 * commit into a fatal "foreign authority" result after application.
 */
function sameAuthorityAckIdentity(
  admitted: CoopTurnResolution | CoopCheckpointEnvelope,
  applied: CoopTurnResolution | CoopCheckpointEnvelope,
): boolean {
  return (
    authorityKey(admitted) === authorityKey(applied)
    && admitted.checkpoint.tick === applied.checkpoint.tick
    && admitted.authoritativeState.tick === applied.authoritativeState.tick
    && admitted.checksum === applied.checksum
  );
}

/** Keep every in-flight staged transaction plus a bounded tail of completed duplicate proofs. */
function rememberAckEvidence<T>(map: Map<string, AckEvidence<T>>, key: string, evidence: AckEvidence<T>): void {
  map.set(key, evidence);
  let completed = 0;
  for (const value of map.values()) {
    completed += value.stage === "continuationReady" ? 1 : 0;
  }
  if (completed <= AUTHORITY_ACK_RETENTION) {
    return;
  }
  for (const [candidate, value] of map) {
    if (candidate !== key && value.stage === "continuationReady") {
      map.delete(candidate);
      return;
    }
  }
}

function legacyTurnKey(turn: number): string {
  return `legacy:${turn}`;
}

function invalidAuthorityTurnKey(turn: number): string {
  return `invalid:${turn}`;
}

function sameRecoveryFrontier(left: CoopRecoveryFrontierV1, right: CoopRecoveryFrontierV1): boolean {
  return left.epoch === right.epoch && left.wave === right.wave && left.turn === right.turn;
}

function sameRecoveryBinding(left: CoopFrameContextV1, right: CoopFrameContextV1): boolean {
  return (
    left.sessionId === right.sessionId
    && left.sessionEpoch === right.sessionEpoch
    && left.seatMapId === right.seatMapId
    && left.membershipRevision === right.membershipRevision
    && left.fromSeatId === right.fromSeatId
    && left.connectionGeneration === right.connectionGeneration
  );
}

function validRecoveryBinding(binding: CoopFrameContextV1): boolean {
  return (
    typeof binding?.sessionId === "string"
    && binding.sessionId.length > 0
    && Number.isSafeInteger(binding.sessionEpoch)
    && binding.sessionEpoch >= 0
    && typeof binding.seatMapId === "string"
    && binding.seatMapId.length > 0
    && Number.isSafeInteger(binding.membershipRevision)
    && binding.membershipRevision >= 0
    && Number.isSafeInteger(binding.fromSeatId)
    && binding.fromSeatId >= 0
    && Number.isSafeInteger(binding.connectionGeneration)
    && binding.connectionGeneration >= 0
  );
}

function validRecoveryFrontier(frontier: CoopRecoveryFrontierV1): boolean {
  return (
    Number.isSafeInteger(frontier?.epoch)
    && frontier.epoch >= 0
    && Number.isSafeInteger(frontier.wave)
    && frontier.wave >= 0
    && Number.isSafeInteger(frontier.turn)
    && frontier.turn >= 0
  );
}

function validRecoveryTicket(ticket: CoopRecoveryTicketV1): boolean {
  return (
    ticket?.version === 1
    && typeof ticket.requestId === "string"
    && ticket.requestId.length > 0
    && Number.isSafeInteger(ticket.seq)
    && ticket.seq > 0
    && (["turn-checksum", "mystery-checksum", "stall", "rejoin", "durability-gap"] as const).includes(ticket.reason)
    && ticket.policy === "exact"
    && validRecoveryBinding(ticket.binding)
    && validRecoveryFrontier(ticket.frontier)
    && ticket.frontier.epoch === ticket.binding.sessionEpoch
  );
}

function recoveryTicketKey(ticket: CoopRecoveryTicketV1): string {
  return canonicalize(ticket);
}

function sameTurnAddress(left: CoopTurnAddress, right: CoopTurnAddress): boolean {
  return left.epoch === right.epoch && left.wave === right.wave && left.turn === right.turn;
}

function newestAuthorityAtAddress<T extends { epoch: number; wave: number; turn: number; revision: number }>(
  entries: ReadonlyMap<string, T>,
  address: { epoch: number; wave: number; turn: number },
): [string, T] | undefined {
  return [...entries.entries()]
    .filter(([, value]) => sameTurnAddress(value, address))
    .sort((left, right) => right[1].revision - left[1].revision)[0];
}

/**
 * Once an exact revision is handed off, older revisions at that same address are causally superseded. Remove
 * them together so a second consumer can never roll mechanics back, while preserving newer revisions and
 * every other epoch/wave/turn.
 */
function discardAuthorityThrough<T extends { epoch: number; wave: number; turn: number; revision: number }>(
  entries: Map<string, T>,
  selected: T,
): void {
  for (const [key, value] of entries) {
    if (sameTurnAddress(value, selected) && value.revision <= selected.revision) {
      entries.delete(key);
    }
  }
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

function replacementIsCausallyDominatedBy(
  retained: CoopCheckpointEnvelope,
  authority: CoopTurnResolution | CoopCheckpointEnvelope,
): boolean {
  const addressAdvanced =
    authority.wave > retained.wave
    || (authority.wave === retained.wave
      && (authority.turn > retained.turn
        || (authority.turn === retained.turn && authority.revision > retained.revision)));
  return (
    authority.epoch === retained.epoch
    && addressAdvanced
    && authority.revision > retained.revision
    && authority.authoritativeState.tick > retained.authoritativeState.tick
  );
}

/**
 * A completed retained operation belongs to a separate revision namespace from battle-stream authority.
 * Compare its exact applied DATA image instead: the same session, a non-older battle address, and a strictly
 * newer state tick prove that the older replacement material is present in the applied state.
 */
function replacementIsSubsumedByOperation(
  retained: CoopCheckpointEnvelope,
  authority: CoopAuthoritativeEnvelopeV1,
): boolean {
  const state = authority.authoritativeState;
  const addressNotOlder =
    authority.wave > retained.wave || (authority.wave === retained.wave && authority.turn >= retained.turn);
  return (
    authority.sessionEpoch === retained.epoch
    && authority.wave === state.wave
    && authority.turn === state.turn
    && addressNotOlder
    && state.tick > retained.authoritativeState.tick
  );
}

function replacementAckIdentity(envelope: CoopCheckpointEnvelope): ReplacementAckIdentity {
  return {
    epoch: envelope.epoch,
    wave: envelope.wave,
    turn: envelope.turn,
    revision: envelope.revision,
    checkpointTick: envelope.checkpoint.tick as number,
    stateTick: envelope.authoritativeState.tick,
    checksum: envelope.checksum,
  };
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
  private readonly recoveryTimeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private readonly authorityContext: (() => { epoch: number; wave: number; turn: number }) | undefined;
  private readonly recoveryBinding: (() => CoopFrameContextV1 | null) | undefined;
  private readonly validatePeerRecoveryBinding: ((binding: CoopFrameContextV1) => boolean) | undefined;
  private readonly authorityRetentionMs: number;
  private readonly authorityRetentionLimit: number;
  private readonly onAuthorityTerminal: ((reason: string) => void) | undefined;
  private readonly onRecoveryTerminal: ((reason: string) => void) | undefined;
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;
  private disposed = false;
  private recoveryDisconnected = false;

  /** Complete turn address -> resolver for an in-flight {@linkcode awaitTurn}. */
  private readonly pending = new Map<string, PendingTurnWaiter>();
  /** #806 stall watchdog: when each parked turn wait began (same keys as `pending`). */
  private readonly pendingSince = new Map<string, number>();
  /** Message class + complete immutable turn address -> a resolution that arrived before its waiter. */
  private readonly inbox = new Map<string, CoopTurnResolution>();
  /** Immutable history survives buffer handoff and ACK; one highest record per complete turn address. */
  private readonly highestSeenTurnAuthority = new Map<string, SeenAuthority<CoopTurnResolution>>();
  /** Exact revision history authenticates delayed failure frames without allowing lower-revision replay. */
  private readonly seenTurnAuthority = new Map<string, SeenAuthority<CoopTurnResolution>>();
  /** A finalizer explicitly requested one idempotent redelivery after a transient apply failure. */
  private readonly turnRedeliveryRequests = new Set<string>();
  /** HOST: complete turn commits remain replayable until the guest ACKs exact convergence. */
  private readonly sentTurnCommits = new Map<string, Extract<CoopMessage, { t: "turnResolution" }>>();
  /** HOST: immutable issued-address proof survives ACK so a delayed guest fatal remains authenticatable. */
  private readonly issuedTurnAuthority = new Set<string>();
  private readonly sentTurnCommitTimers = new Map<string, () => void>();
  private readonly sentTurnCommitDeadlines = new Map<string, number>();
  /** GUEST: every turn requested but not yet apply+checksum ACKed, including reconnect replay. */
  private readonly requestedTurnCommits = new Map<string, TurnCommitRequest>();
  private readonly turnRequestTimers = new Map<string, () => void>();
  private readonly turnCommitHandlers = new Set<(resolution: CoopTurnResolution) => void>();
  /** GUEST: latest monotonic evidence emitted for each exact immutable turn commit. */
  private readonly ackedTurnCommits = new Map<string, AckEvidence<Extract<CoopMessage, { t: "turnCommitAck" }>>>();
  /** HOST: latest accepted evidence. Retention is released only at continuationReady. */
  private readonly hostTurnAckEvidence = new Map<string, AckEvidence<Extract<CoopMessage, { t: "turnCommitAck" }>>>();
  /** GUEST: presentation-complete turn commits waiting for their real public continuation surface. */
  private readonly pendingTurnContinuations = new Map<string, PendingTurnContinuation>();
  /** Exact retained wave carriers admitted after/before an early next-command continuation prediction. */
  private readonly admittedWaveAdvanceContinuations = new Set<string>();
  /**
   * GUEST: live battle events buffered by turn, keyed inner by `seq` so a duplicate / out-of-order
   * `battleEvent` is de-duped + a stutter (a missing seq) is tolerated (#633, animation layer LIVE).
   * Consumed in seq order by `CoopReplayTurnPhase` at the turn boundary, so the guest never replays a
   * live event twice (it de-dupes the turn-end batch against these). A bounded number of past turns is
   * retained ({@linkcode LIVE_EVENT_TURN_RETENTION}) so a late event for a just-finished turn is not
   * silently dropped while old turns never leak.
   */
  private readonly liveEvents = new Map<string, LiveTurnBuffer>();
  /**
   * GUEST (#822 / Track R cycle 13 duplicate-replay double-render): the highest number of event POSITIONS
   * (seq 0..N-1) already RENDERED for a turn address, SHARED across every {@linkcode CoopReplayTurnPhase}
   * instance for the same turn. {@linkcode consumeLiveEventsFrom} DELETES the live events it drains, so a
   * DUPLICATE replay phase (spawned by the ME-battle boot, resolving with its OWN instance watermark
   * `rendered=0` BEFORE the real instance's finalize marks the turn finalized) finds the live buffer empty
   * and {@linkcode CoopReplayTurnPhase.mergeLiveAndBatch} batch-FILLS the whole turn again -> double-applied
   * damage/stat stages -> stable enemyParty.hp/statStages divergence. This watermark scopes the
   * exactly-once render to the LIVE-EVENT STREAM: whichever phase renders a position advances it, so a
   * second phase for the same turn re-renders nothing already covered. Keyed like {@linkcode liveEvents};
   * cleared with them on every session/authority reset and on wave advance ({@linkcode clearFinalizedMark}),
   * so a legitimate post-resync/checkpoint-reapply re-render of a fresh turn address always starts at zero.
   */
  private readonly renderedThrough = new Map<string, number>();
  /** Exact V2 replacement revisions whose switch/summon phase drained before checkpoint installation. */
  private readonly renderedReplacementPresentations = new Set<string>();
  /**
   * Exact addressed waits cancelled because the renderer opened the same numeric
   * turn in a newer wave/epoch. The replay pump distinguishes this benign stale
   * continuation from a real authority timeout; otherwise cancelling wave N's
   * orphaned turn-1 pump terminalizes the healthy wave N+1 pump.
   */
  private readonly supersededTurnWaits = new Set<string>();
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
  /**
   * authority-v2 CUTOVER: exact immutable turn identities whose COMPLETE live finalize path succeeded.
   * `finalizedMarks` intentionally answers the broader legacy question "is turn N-or-earlier stale?";
   * it cannot prove which revision/material image finalized. V2 materialApplied receipts require this
   * address+revision identity so a queued carrier, a superseded revision, or a same-address conflict can
   * never masquerade as installed material.
   */
  private readonly finalizedTurnAuthorities = new Set<string>();
  /** Exact immutable replacement carriers whose complete apply+checksum material transaction succeeded. */
  private readonly finalizedReplacementAuthorities = new Set<string>();

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

  /**
   * Record exact Authority V2 material completion after the real replay/finalize/checksum path succeeded.
   * The immutable admission ledger supplies the identity because engine appliers may normalize their
   * disposable resolution copy in place. Returns false unless this exact revision was admitted.
   */
  markAuthoritativeTurnFinalized(resolution: CoopTurnResolution): boolean {
    const exactKey = authorityKey(resolution);
    const admitted = this.seenTurnAuthority.get(exactKey);
    if (admitted == null || !sameAuthorityAckIdentity(admitted.value, resolution)) {
      return false;
    }
    rememberBoundedValue(this.finalizedTurnAuthorities, exactKey);
    this.markTurnFinalized(resolution.epoch, resolution.wave, resolution.turn);
    return true;
  }

  /**
   * Whether this exact immutable V2 carrier has completed the REAL live material path. Admission/buffering
   * alone is deliberately insufficient: the canonical entry must match and its exact revision must have
   * reached CoopFinalizeTurnPhase's apply + checksum + projection boundary.
   */
  hasFinalizedAuthoritativeV2Turn(
    resolution: CoopTurnResolution | Extract<CoopMessage, { t: "turnResolution" }>,
  ): boolean {
    // Strip the wire discriminant when the cutover seam supplies the legacy message shape: admission stores
    // CoopTurnResolution, so canonical identity must compare like-for-like rather than including `t`.
    const normalized: CoopTurnResolution = {
      epoch: resolution.epoch,
      wave: resolution.wave,
      turn: resolution.turn,
      revision: resolution.revision,
      events: resolution.events,
      checkpoint: resolution.checkpoint,
      checksum: resolution.checksum,
      preimage: resolution.preimage,
      fullField: resolution.fullField,
      authoritativeState: resolution.authoritativeState,
    };
    const exactKey = authorityKey(normalized);
    const admitted = this.seenTurnAuthority.get(exactKey);
    return (
      admitted != null && admitted.canonical === canonicalize(normalized) && this.finalizedTurnAuthorities.has(exactKey)
    );
  }

  private markAuthoritativeReplacementFinalized(envelope: CoopCheckpointEnvelope): boolean {
    const mechanicalEnvelope = mechanicalCheckpointEnvelope(envelope);
    const exactKey = authorityKey(mechanicalEnvelope);
    const admitted = this.seenReplacementAuthority.get(exactKey);
    if (
      admitted == null
      || admitted.canonical !== canonicalize(mechanicalEnvelope)
      || !sameAuthorityAckIdentity(admitted.value, mechanicalEnvelope)
    ) {
      return false;
    }
    rememberBoundedValue(this.finalizedReplacementAuthorities, exactKey);
    return true;
  }

  /** V2 material receipt proof: admission is insufficient; the exact carrier must have converged in-engine. */
  hasFinalizedAuthoritativeV2Replacement(
    message: CoopCheckpointEnvelope | Extract<CoopMessage, { t: "battleCheckpoint" }>,
  ): boolean {
    const normalized = mechanicalCheckpointEnvelope(message);
    const exactKey = authorityKey(normalized);
    const admitted = this.seenReplacementAuthority.get(exactKey);
    return (
      admitted != null
      && admitted.canonical === canonicalize(normalized)
      && this.finalizedReplacementAuthorities.has(exactKey)
    );
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
   * Whether a retained REPLACEMENT checkpoint is buffered that the live pump's fast path
   * ({@link awaitTurnOrLiveEvent}) would consume for this exact replay turn. This distinguishes a
   * materialized SAME-TURN replacement carrier - which MUST be consumed even though its turn was already
   * finalized (the post-summon replacement legitimately shares the finalized turn's number) - from a STALE
   * duplicate turn-resolution pump that the host will never resend (the #790 phantom the start()-time guard
   * kills). It mirrors the pump fast-path condition exactly (peek + reason==="replacement" +
   * {@link checkpointCanWakeTurn}) so a "don't bail" verdict here is guaranteed to make synchronous progress.
   */
  hasConsumableReplacementForTurn(turn: number, sourceWave?: number): boolean {
    const checkpoint = this.peekCheckpointForTurn(turn, sourceWave);
    if (checkpoint == null || checkpoint.reason !== "replacement") {
      return false;
    }
    return this.checkpointCanWakeTurn(checkpoint, this.currentAuthorityAddress(turn, sourceWave), turn);
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
    // `finalizedMarks` is a wave-local renderer duplicate guard. The exact
    // Authority V2 proof is different: the retained log may redeliver the final
    // turn only AFTER this wave transition, and that redelivery must observe the
    // completed material boundary so it can emit materialApplied and retire.
    // Its keys contain epoch+wave+turn+revision and are independently bounded by
    // rememberBoundedValue, so retaining them cannot collide with next-wave turn 1.
    // Scope the per-turn render watermark to the wave, exactly like finalizedMarks: a fresh wave restarts
    // at turn 1, and (without an authority context to fold the wave into the key) the `t:1` key would
    // otherwise collide with the finished wave's turn 1 and wrongly suppress its first legitimate render.
    this.renderedThrough.clear();
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
  /** Showdown pre-command presentation, delivered by the retained post-summon wave carrier. */
  private readonly entryPresentationByWave = new Map<number, CoopEntryPresentationPrefix>();
  private readonly entryPresentationWaiters = new Map<number, (prefix: CoopEntryPresentationPrefix | null) => void>();
  /** Monotonic run-local exact-once watermark; avoids an unbounded per-wave tombstone set. */
  private consumedEntryPresentationThroughWave = 0;
  /** ME-battle key -> resolver for an in-flight {@linkcode awaitMeBattleEnemyParty} (#633 ME handoff). */
  private readonly meBattlePartyWaiters = new Map<string, (res: CoopSerializedEnemy[] | null) => void>();
  /** ME-battle key -> a party that arrived before its waiter (race buffer, #633 ME handoff). */
  private readonly meBattlePartyInbox = new Map<string, CoopSerializedEnemy[]>();
  /** HOST: retained authoritative ME parties, re-answerable by exact interaction key after loss/reconnect. */
  private readonly sentMeBattleParties = new Map<string, CoopSerializedEnemy[]>();
  /** Message class + complete immutable replacement address -> checkpoints not yet handed to an applier. */
  private readonly pendingCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  /** Immutable replacement history persists across buffer, handoff, applied-OOB, and ACK states. */
  private readonly highestSeenReplacementAuthority = new Map<string, SeenAuthority<CoopCheckpointEnvelope>>();
  private readonly seenReplacementAuthority = new Map<string, SeenAuthority<CoopCheckpointEnvelope>>();
  private readonly replacementRedeliveryRequests = new Set<string>();
  /** HOST: latest complete replacement frame, retained for explicit guest retransmit requests. */
  private readonly sentReplacementCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  private readonly issuedReplacementAuthority = new Set<string>();
  private readonly sentReplacementTimers = new Map<string, () => void>();
  private readonly sentReplacementDeadlines = new Map<string, number>();
  private readonly ackedReplacementCommits = new Map<
    string,
    AckEvidence<Extract<CoopMessage, { t: "battleCheckpointAck" }>>
  >();
  private readonly hostReplacementAckEvidence = new Map<
    string,
    AckEvidence<Extract<CoopMessage, { t: "battleCheckpointAck" }>>
  >();
  private readonly pendingReplacementContinuations = new Map<string, PendingReplacementContinuation>();
  /** HOST: bounded proof that a causally newer replacement was ACKed before an old turn is superseded. */
  private readonly hostAppliedReplacementAcks = new Map<string, Extract<CoopMessage, { t: "battleCheckpointAck" }>>();
  /**
   * HOST: immutable identities of replacement frames retired by a newer, fully-applied authority commit.
   * A delayed ACK for one of these frames is harmless and must not turn successful convergence into a
   * protocol fatal after its retry/timer was deliberately released.
   */
  private readonly causallyRetiredReplacementAuthority = new Map<string, ReplacementAckIdentity>();
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
  /** One shared fail-closed outcome bounds all retained authority and its retry resources. */
  private authorityTerminalStarted = false;
  private authorityTerminalCallbackInvoked = false;
  private authorityFailureRevision = 0;
  /**
   * Latest out-of-band checkpoint the live replay pump already applied to unblock an
   * intra-turn interaction. Presentation phases can subsequently mutate that state
   * before the older turn-resolution finalizer runs, so the finalizer consumes this
   * envelope and reasserts its newer full state at the safe post-animation boundary.
   */
  private readonly appliedOutOfBandCheckpoints = new Map<string, CoopCheckpointEnvelope>();
  /** Latest enemy party the guest has not yet adopted (consumed at the wave's first turn). */
  private lastEnemyParty: { wave: number; enemies: CoopSerializedEnemy[]; stateTick?: number } | null = null;
  /** HOST: exact wave-boundary carriers retained for loss/reconnect replay. */
  private readonly sentEnemyParties = new Map<number, Extract<CoopMessage, { t: "enemyPartySync" }>>();
  /** New-wave state paired with enemyPartySync; consumed after the guest has built the streamed enemies. */
  private readonly enemyPartyStateByWave = new Map<number, CoopAuthoritativeBattleStateV1>();
  /** Complete encounter identity paired with the replayable wave carrier; consumed atomically at adopt. */
  private readonly enemyPartyEncounterByWave = new Map<number, CoopEncounterAuthority>();
  /**
   * Guest causal floor for wave-keyed enemy-party authority. Mystery selection and its spawned battle can
   * share one wave number; once the retained ME terminal applies a newer full state, an older selector
   * carrier must never repopulate the party/encounter inbox merely because its wave still matches.
   */
  private readonly enemyPartyAuthorityFloorByWave = new Map<number, number>();
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
  /** HOST: handler answering one already-authenticated exact recovery ticket. */
  private stateSyncRequestHandler: ((ticket: CoopRecoveryTicketV1) => void) | null = null;
  /** HOST: handler answering the guest's `requestEnemyParty` re-request (#633/#698 handoff robustness). */
  private enemyPartyRequestHandler: ((wave: number) => void) | null = null;
  /** GUEST: complete immutable ticket -> one in-flight recovery waiter. */
  private readonly stateSyncWaiters = new Map<string, PendingStateSyncWaiter>();
  /** GUEST: monotonic resync request counter (each desync request bumps it). */
  private stateSyncSeq = 0;
  /** HOST: monotonic identity for addressed durability pushes. */
  private durabilitySnapshotSeq = 0;
  /** GUEST: live apply callback for an addressed deep-gap durability snapshot. */
  private durabilitySnapshotHandler: ((result: CoopStateSyncResult) => void) | null = null;
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
    this.recoveryTimeoutMs =
      Number.isSafeInteger(opts.recoveryTimeoutMs) && (opts.recoveryTimeoutMs as number) > 0
        ? (opts.recoveryTimeoutMs as number)
        : COOP_STATE_SYNC_RECOVERY_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.now = opts.now ?? Date.now;
    this.authorityContext = opts.authorityContext;
    this.recoveryBinding = opts.recoveryBinding;
    this.validatePeerRecoveryBinding = opts.validatePeerRecoveryBinding;
    this.authorityRetentionMs =
      Number.isFinite(opts.authorityRetentionMs) && (opts.authorityRetentionMs as number) > 0
        ? (opts.authorityRetentionMs as number)
        : AUTHORITY_COMMIT_RETENTION_MS;
    this.authorityRetentionLimit =
      Number.isSafeInteger(opts.authorityRetentionLimit) && (opts.authorityRetentionLimit as number) > 0
        ? (opts.authorityRetentionLimit as number)
        : AUTHORITY_COMMIT_RETENTION;
    this.onAuthorityTerminal = opts.onAuthorityTerminal;
    this.onRecoveryTerminal = opts.onRecoveryTerminal;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offStateChange = transport.onStateChange((state: CoopConnectionState) => {
      if (state !== "connected") {
        this.recoveryDisconnected = true;
        return;
      }
      if (!this.authorityTerminalStarted) {
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
      }
      if (this.pendingAuthorityFailure != null) {
        this.transport.send(this.pendingAuthorityFailure.message);
      }
      if (!this.authorityTerminalStarted) {
        for (const request of this.requestedTurnCommits.values()) {
          this.sendTurnCommitRequest(request);
        }
      }
      for (const wave of this.launchSnapshotWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestLaunchSnapshot wave=${wave} after reconnect`);
        this.transport.send({ t: "requestLaunchSnapshot", wave });
      }
      for (const wave of this.enemyPartyWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestEnemyParty wave=${wave} after reconnect`);
        this.transport.send({ t: "requestEnemyParty", wave });
      }
      for (const wave of this.entryPresentationWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestEnemyParty wave=${wave} for entry presentation after reconnect`);
        this.transport.send({ t: "requestEnemyParty", wave });
      }
      for (const key of this.meBattlePartyWaiters.keys()) {
        coopLog("stream", `guest RE-SEND requestMeBattleEnemyParty key=${key} after reconnect`);
        this.transport.send({ t: "requestMeBattleEnemyParty", key });
      }
      if (this.recoveryDisconnected) {
        this.recoveryDisconnected = false;
        for (const waiter of [...this.stateSyncWaiters.values()]) {
          coopWarn(
            "resync",
            `guest cancel stateSync id=${waiter.ticket.requestId} after reconnect; a new generation requires a new ticket`,
          );
          waiter.finish({ kind: "reconnect-cancelled" });
        }
      }
    });
    coopLog(
      "stream",
      `streamer CONSTRUCT timeout=${this.timeoutMs}ms recoveryTimeout=${this.recoveryTimeoutMs}ms onMessage registered`,
    );
  }

  private currentAuthorityAddress(turn?: number, wave?: number): { epoch: number; wave: number; turn: number } | null {
    if (this.authorityContext == null) {
      return null;
    }
    if (
      (turn !== undefined && !isSafeAddressPart(turn, false))
      || (wave !== undefined && !isSafeAddressPart(wave, false))
    ) {
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
      return {
        ...current,
        ...(wave === undefined ? {} : { wave }),
        ...(turn === undefined ? {} : { turn }),
      };
    } catch {
      return null;
    }
  }

  private currentStateSyncAddress(): CoopTurnAddress | null {
    if (this.authorityContext == null) {
      return null;
    }
    try {
      const current = this.authorityContext();
      if (
        current == null
        || !isSafeAddressPart(current.epoch, false)
        || !isSafeAddressPart(current.wave)
        || !isSafeAddressPart(current.turn)
      ) {
        return null;
      }
      return { epoch: current.epoch, wave: current.wave, turn: current.turn };
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

  private currentRecoveryBinding(): CoopFrameContextV1 | null {
    if (this.recoveryBinding != null) {
      try {
        const binding = this.recoveryBinding();
        return binding != null && validRecoveryBinding(binding) ? { ...binding } : null;
      } catch {
        return null;
      }
    }
    const frontier = this.currentStateSyncAddress();
    if (frontier == null) {
      return null;
    }
    return {
      sessionId: `legacy-recovery:e${frontier.epoch}`,
      sessionEpoch: frontier.epoch,
      seatMapId: `legacy-seat-map:e${frontier.epoch}`,
      membershipRevision: 0,
      fromSeatId: this.transport.role === "host" ? 0 : 1,
      connectionGeneration: this.transport.connectionGeneration?.() ?? 0,
    };
  }

  private peerRecoveryBindingIsCurrent(binding: CoopFrameContextV1): boolean {
    if (!validRecoveryBinding(binding)) {
      return false;
    }
    if (this.validatePeerRecoveryBinding != null) {
      try {
        return this.validatePeerRecoveryBinding(binding);
      } catch {
        return false;
      }
    }
    const local = this.currentRecoveryBinding();
    return (
      local != null
      && binding.sessionId === local.sessionId
      && binding.sessionEpoch === local.sessionEpoch
      && binding.seatMapId === local.seatMapId
      && binding.membershipRevision === local.membershipRevision
      && binding.fromSeatId !== local.fromSeatId
      && binding.connectionGeneration === local.connectionGeneration
    );
  }

  private localRecoveryTicketIsCurrent(ticket: CoopRecoveryTicketV1): boolean {
    const binding = this.currentRecoveryBinding();
    const frontier = this.currentStateSyncAddress();
    return (
      validRecoveryTicket(ticket)
      && binding != null
      && frontier != null
      && sameRecoveryBinding(ticket.binding, binding)
      && sameRecoveryFrontier(ticket.frontier, frontier)
    );
  }

  private peerRecoveryTicketIsCurrent(ticket: CoopRecoveryTicketV1): boolean {
    const frontier = this.currentStateSyncAddress();
    return (
      validRecoveryTicket(ticket)
      && frontier != null
      && this.peerRecoveryBindingIsCurrent(ticket.binding)
      && sameRecoveryFrontier(ticket.frontier, frontier)
    );
  }

  /** Revalidate immutable receive evidence immediately before a deferred snapshot mutates live state. */
  recoveryAdmissionIsCurrent(admission: CoopRecoveryAdmissionV1, snapshot?: CoopFullBattleSnapshot): boolean {
    const { ticket, captured } = admission;
    if (
      !validRecoveryTicket(ticket)
      || captured?.version !== 1
      || !validRecoveryBinding(captured.binding)
      || !validRecoveryFrontier(captured.frontier)
      || !Number.isSafeInteger(captured.stateTick)
      || captured.stateTick < 0
      || typeof captured.controlDigest !== "string"
      || captured.controlDigest.length === 0
      || !sameRecoveryFrontier(ticket.frontier, captured.frontier)
      || !this.peerRecoveryBindingIsCurrent(captured.binding)
    ) {
      return false;
    }
    const addressCurrent =
      ticket.reason === "durability-gap"
        ? this.peerRecoveryTicketIsCurrent(ticket) && sameRecoveryBinding(ticket.binding, captured.binding)
        : this.localRecoveryTicketIsCurrent(ticket);
    if (!addressCurrent || snapshot == null) {
      return addressCurrent;
    }
    const state = snapshot.authoritativeState;
    return (
      snapshot.sessionEpoch === ticket.frontier.epoch
      && state != null
      && state.wave === ticket.frontier.wave
      && state.turn === ticket.frontier.turn
      && state.tick === captured.stateTick
      && snapshot.controlDigest === captured.controlDigest
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
    return current.turn === address.turn || this.pending.has(key) || this.hasRequestedTurnAddress(address);
  }

  private hasRequestedTurnAddress(address: CoopTurnAddress): boolean {
    return [...this.requestedTurnCommits.values()].some(request => sameTurnAddress(request, address));
  }

  private acceptsAuthorityFailureAddress(failure: CoopAuthorityFailure): boolean {
    if (this.authorityContext == null) {
      return true;
    }
    const current = this.currentAuthorityAddress();
    if (current == null || current.epoch !== failure.epoch) {
      return false;
    }
    const turnKey = pendingTurnKey(failure);
    const exactKey = authorityKey(failure);
    const hasExactAddressEvidence =
      this.pending.has(turnKey)
      || this.hasRequestedTurnAddress(failure)
      || this.sentTurnCommits.has(exactKey)
      || this.sentReplacementCheckpoints.has(exactKey)
      || this.issuedTurnAuthority.has(exactKey)
      || this.issuedReplacementAuthority.has(exactKey)
      || this.ackedTurnCommits.has(exactKey)
      || this.ackedReplacementCommits.has(exactKey)
      || this.seenTurnAuthority.has(exactKey)
      || this.seenReplacementAuthority.has(exactKey);
    // A raw compatibility hint or speculative next battle can advance ambient wave state before a
    // delayed terminal frame arrives. Exact immutable authority evidence remains the stronger address
    // proof; accepting it is fail-closed and prevents one peer waiting forever at the successor shell.
    return hasExactAddressEvidence || (current.wave === failure.wave && current.turn === failure.turn);
  }

  /**
   * Replacement authority is captured after TurnEnd increments the host battle turn. The guest can
   * legitimately still be parked on the just-resolved turn while its owner picker is open, so admit
   * exactly N+1 only when an exact N turn wait proves that old boundary is still live. Conversely,
   * a renderer can enter its derived TurnInit before the delayed replacement carrier arrives; admit
   * exactly N-1 only while an exact N replay wait/request proves that successor shell is genuinely live.
   */
  private acceptsCheckpointAddress(envelope: CoopCheckpointEnvelope): boolean {
    if (this.acceptsCurrentAddress(envelope)) {
      return true;
    }
    const current = this.currentAuthorityAddress();
    if (
      current == null
      || envelope.reason !== "replacement"
      || envelope.epoch !== current.epoch
      || envelope.wave !== current.wave
      || (envelope.turn !== current.turn + 1 && envelope.turn + 1 !== current.turn)
    ) {
      return false;
    }
    const currentKey = pendingTurnKey(current);
    return this.pending.has(currentKey) || this.hasRequestedTurnAddress(current);
  }

  private classifyAuthority<T extends { epoch: number; wave: number; turn: number; revision: number }>(
    highestByAddress: Map<string, SeenAuthority<T>>,
    seenByRevision: Map<string, SeenAuthority<T>>,
    value: T,
  ): AuthorityAdmission<T> {
    const addressKey = pendingTurnKey(value);
    const exactKey = authorityKey(value);
    const canonical = canonicalize(value);
    const highest = highestByAddress.get(addressKey);
    if (highest != null) {
      if (value.revision < highest.revision) {
        return { kind: "older" };
      }
      if (value.revision === highest.revision) {
        return highest.canonical === canonical ? { kind: "identical", seen: highest } : { kind: "conflict" };
      }
    }
    // Keep the ledger structurally independent from every object handed to engine/render consumers. Several
    // production appliers legitimately normalize their input in place; retaining that same reference made the
    // later staged ACK compare a post-apply object against pre-apply bytes and terminate a converged peer.
    const seen = { revision: value.revision, canonical, value: structuredClone(value) };
    // These maps are the immutable admission ledger for this stream lifetime, not an inbox cache. They
    // deliberately survive handoff/application/ACK and are cleared only by dispose or a shared terminal.
    // Bounding them like a delivery buffer would allow a long campaign to forget an old immutable address
    // and later accept a conflicting replay as new authority.
    seenByRevision.set(exactKey, seen);
    highestByAddress.set(addressKey, seen);
    return { kind: "new", seen };
  }

  private turnWaitAddress(turn: number, sourceWave?: number): { key: string; address: CoopTurnAddress | null } {
    const address = this.currentAuthorityAddress(turn, sourceWave);
    if (address != null) {
      return { key: pendingTurnKey(address), address };
    }
    return {
      key: this.authorityContext == null ? legacyTurnKey(turn) : invalidAuthorityTurnKey(turn),
      address: null,
    };
  }

  private bufferedTurnEntry(turn: number, sourceWave?: number): [string, CoopTurnResolution] | undefined {
    const current = this.currentAuthorityAddress(turn, sourceWave);
    if (this.authorityContext != null) {
      if (current == null) {
        return;
      }
      return newestAuthorityAtAddress(this.inbox, current);
    }
    return [...this.inbox.entries()].reverse().find(([, resolution]) => resolution.turn === turn);
  }

  private liveTurnEntry(turn: number, sourceWave?: number): [string, LiveTurnBuffer] | undefined {
    const current = this.currentAuthorityAddress(turn, sourceWave);
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
      return newestAuthorityAtAddress(this.pendingCheckpoints, current);
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
        || (envelope.reason === "replacement"
          && (envelope.turn === waitedAddress.turn + 1 || envelope.turn + 1 === waitedAddress.turn)))
    );
  }

  private retainedAuthorityCount(): number {
    return this.sentTurnCommits.size + this.sentReplacementCheckpoints.size;
  }

  private cancelRetainedAuthorityTimers(): void {
    for (const cancel of this.sentTurnCommitTimers.values()) {
      cancel();
    }
    this.sentTurnCommitTimers.clear();
    for (const cancel of this.sentReplacementTimers.values()) {
      cancel();
    }
    this.sentReplacementTimers.clear();
    for (const cancel of this.turnRequestTimers.values()) {
      cancel();
    }
    this.turnRequestTimers.clear();
  }

  private clearRetainedAuthorityAfterTerminal(): void {
    this.sentTurnCommits.clear();
    this.issuedTurnAuthority.clear();
    this.sentTurnCommitDeadlines.clear();
    this.sentReplacementCheckpoints.clear();
    this.issuedReplacementAuthority.clear();
    this.sentReplacementDeadlines.clear();
    this.requestedTurnCommits.clear();
    this.turnRedeliveryRequests.clear();
    this.replacementRedeliveryRequests.clear();
    this.ackedTurnCommits.clear();
    this.hostTurnAckEvidence.clear();
    this.pendingTurnContinuations.clear();
    this.admittedWaveAdvanceContinuations.clear();
    this.ackedReplacementCommits.clear();
    this.hostReplacementAckEvidence.clear();
    this.pendingReplacementContinuations.clear();
    this.hostAppliedReplacementAcks.clear();
    this.causallyRetiredReplacementAuthority.clear();
    this.inbox.clear();
    this.pendingSince.clear();
    this.liveEvents.clear();
    this.renderedThrough.clear();
    this.renderedReplacementPresentations.clear();
    this.pendingCheckpoints.clear();
    this.appliedOutOfBandCheckpoints.clear();
    this.highestSeenTurnAuthority.clear();
    this.seenTurnAuthority.clear();
    this.highestSeenReplacementAuthority.clear();
    this.seenReplacementAuthority.clear();
    this.turnCommitHandlers.clear();
    this.checkpointEnvelopeHandlers.clear();
    this.liveEventHandler = null;
    this.liveWaiter = null;
    this.checkpointWaiter = null;
    this.checkpointHandler = null;
    this.authorityFailureHandlers.clear();
  }

  private cancelAuthorityGameplayWaiters(): void {
    for (const pending of [...this.pending.values()]) {
      pending.finish(null);
    }
    for (const finish of [...this.enemyPartyWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.entryPresentationWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.meBattlePartyWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.launchSnapshotWaiters.values()]) {
      finish(null);
    }
    for (const waiter of [...this.stateSyncWaiters.values()]) {
      waiter.finish({ kind: "superseded" });
    }
    this.pending.clear();
    this.pendingSince.clear();
    this.enemyPartyWaiters.clear();
    this.entryPresentationWaiters.clear();
    this.meBattlePartyWaiters.clear();
    this.launchSnapshotWaiters.clear();
    this.stateSyncWaiters.clear();
    this.liveWaiter = null;
    this.checkpointWaiter = null;
  }

  private invokeAuthorityTerminal(reason: string, failureId: string): void {
    if (this.disposed || this.authorityTerminalCallbackInvoked) {
      return;
    }
    this.authorityTerminalCallbackInvoked = true;
    this.clearRetainedAuthorityAfterTerminal();
    try {
      this.onAuthorityTerminal?.(reason);
    } catch (error) {
      coopWarn("stream", `authority terminal hook threw after ${failureId}`, error);
    }
  }

  /** Diagnostic proof used by tracing/gates; terminal completion must leave every authority resource empty. */
  retainedAuthorityDiagnostics(): {
    turnCommits: number;
    replacementCommits: number;
    deliveryTimers: number;
    requestTimers: number;
    requests: number;
    redeliveryRequests: number;
    bufferedAuthority: number;
    history: number;
    acknowledgements: number;
    waiters: number;
    fatalPending: boolean;
    terminal: boolean;
  } {
    return {
      turnCommits: this.sentTurnCommits.size,
      replacementCommits: this.sentReplacementCheckpoints.size,
      deliveryTimers: this.sentTurnCommitTimers.size + this.sentReplacementTimers.size,
      requestTimers: this.turnRequestTimers.size,
      requests: this.requestedTurnCommits.size,
      redeliveryRequests: this.turnRedeliveryRequests.size + this.replacementRedeliveryRequests.size,
      bufferedAuthority: this.inbox.size + this.pendingCheckpoints.size + this.appliedOutOfBandCheckpoints.size,
      history:
        this.highestSeenTurnAuthority.size
        + this.seenTurnAuthority.size
        + this.highestSeenReplacementAuthority.size
        + this.seenReplacementAuthority.size
        + this.issuedTurnAuthority.size
        + this.issuedReplacementAuthority.size,
      acknowledgements:
        this.ackedTurnCommits.size
        + this.hostTurnAckEvidence.size
        + this.ackedReplacementCommits.size
        + this.hostReplacementAckEvidence.size
        + this.hostAppliedReplacementAcks.size,
      waiters:
        this.pending.size
        + this.enemyPartyWaiters.size
        + this.meBattlePartyWaiters.size
        + this.launchSnapshotWaiters.size
        + this.stateSyncWaiters.size
        + this.pendingTurnContinuations.size
        + this.pendingReplacementContinuations.size,
      fatalPending: this.pendingAuthorityFailure != null,
      terminal: this.authorityTerminalStarted,
    };
  }

  /**
   * Stop gameplay delivery and enter the retained, peer-acknowledged fatal contract. Authority payloads
   * remain available until that contract is ACKed or reaches its own absolute deadline; only then may the
   * terminal hook tear down production. This is a latch: once either peer has observed the fatal frame,
   * this stream can never resume from a partially acknowledged authority history.
   */
  private beginAuthorityTerminal(failure: Omit<CoopAuthorityFailure, "t" | "failureId"> & { failureId: string }): void {
    if (this.disposed || this.authorityTerminalStarted) {
      return;
    }
    this.authorityTerminalStarted = true;
    this.cancelRetainedAuthorityTimers();
    this.cancelAuthorityGameplayWaiters();
    const reason = failure.reason;
    const outcome = this.broadcastAuthorityFailure(failure);
    void outcome.then(() => {
      this.invokeAuthorityTerminal(reason, failure.failureId);
    });
  }

  /** Receiver half of the fatal contract: ACK once, latch locally, then tear down without echoing a fatal. */
  private receiveAuthorityTerminal(
    failure: CoopAuthorityFailure,
    ack: Extract<CoopMessage, { t: "authorityFailureAck" }>,
  ): void {
    this.authorityTerminalStarted = true;
    this.cancelRetainedAuthorityTimers();
    this.cancelAuthorityGameplayWaiters();
    if (this.pendingAuthorityFailure != null) {
      const crossed = this.pendingAuthorityFailure;
      crossed.cancel();
      this.pendingAuthorityFailure = null;
      crossed.resolve(false);
    }
    this.lastAuthorityFailure = failure;
    // ACK is emitted before any observer or runtime hook can dispose the transport. A received fatal never
    // broadcasts another fatal, so simultaneous failures converge without ping-pong.
    this.transport.send(ack);
    for (const handler of [...this.authorityFailureHandlers]) {
      try {
        handler(failure);
      } catch (error) {
        coopWarn("stream", `authority failure observer threw id=${failure.failureId} (isolated)`, error);
      }
    }
    // Yield once so queued transports (including the production RTC wrapper and the loopback gate) can
    // deliver the ACK before the runtime hook closes the channel during shared-session teardown.
    queueMicrotask(() => this.invokeAuthorityTerminal(failure.reason, failure.failureId));
  }

  private enforceRetainedAuthorityBound(
    boundary: "turnResolution" | "replacement",
    address: { epoch: number; wave: number; turn: number; revision: number },
    key: string,
    deadline: number,
  ): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const expired = this.now() >= deadline;
    const overCapacity = this.retainedAuthorityCount() > this.authorityRetentionLimit;
    if (!expired && !overCapacity) {
      return true;
    }
    const reason = expired
      ? `${boundary} authority ${key} was not acknowledged before its retention deadline.`
      : `Authority retention exceeded ${this.authorityRetentionLimit} unacknowledged commits.`;
    coopWarn("stream", `host retained authority terminal: ${reason}`);
    this.beginAuthorityTerminal({
      // `address` can be a retained turnResolution object at runtime. Copy only the authenticated
      // address fields: spreading that carrier would also copy its `t`, allowing it to overwrite the
      // fatal discriminator and silently retransmit gameplay after the terminal latch.
      epoch: address.epoch,
      wave: address.wave,
      turn: address.turn,
      revision: address.revision,
      boundary,
      reason,
      failureId: `retained:${boundary}:${key}`,
    });
    return false;
  }

  private retainAndRetryTurnCommit(
    commit: Extract<CoopMessage, { t: "turnResolution" }>,
    cosmeticOnly = false,
  ): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    // authority-v2 turn CUTOVER: the v2 authority log already committed this turn, so the legacy carrier is
    // COSMETIC. Send it once (the caller does) for observability, but do NOT retain / schedule the RE-SEND
    // loop / track it as issued authority - the v2 log owns retention + redelivery. This is the frozen "no
    // second authority for a cut-over surface" rule: the legacy turn-commit RE-SEND loop must not run.
    if (cosmeticOnly) {
      return true;
    }
    const key = authorityKey(commit);
    const retainedCommit = structuredClone(commit);
    this.issuedTurnAuthority.add(key);
    this.sentTurnCommits.set(key, retainedCommit);
    const deadline = this.sentTurnCommitDeadlines.get(key) ?? this.now() + this.authorityRetentionMs;
    this.sentTurnCommitDeadlines.set(key, deadline);
    this.sentTurnCommitTimers.get(key)?.();
    if (!this.enforceRetainedAuthorityBound("turnResolution", commit, key, deadline)) {
      return false;
    }
    const retry = () => {
      const retained = this.sentTurnCommits.get(key);
      if (retained == null || this.authorityTerminalStarted) {
        this.sentTurnCommitTimers.delete(key);
        return;
      }
      const retainedDeadline = this.sentTurnCommitDeadlines.get(key) ?? deadline;
      if (!this.enforceRetainedAuthorityBound("turnResolution", retained, key, retainedDeadline)) {
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
    return true;
  }

  private retainAndRetryReplacement(envelope: CoopCheckpointEnvelope): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const key = authorityKey(envelope);
    const retainedEnvelope = structuredClone(envelope);
    this.issuedReplacementAuthority.add(key);
    this.sentReplacementCheckpoints.set(key, retainedEnvelope);
    const deadline = this.sentReplacementDeadlines.get(key) ?? this.now() + this.authorityRetentionMs;
    this.sentReplacementDeadlines.set(key, deadline);
    this.sentReplacementTimers.get(key)?.();
    if (!this.enforceRetainedAuthorityBound("replacement", envelope, key, deadline)) {
      return false;
    }
    const retry = () => {
      const retained = this.sentReplacementCheckpoints.get(key);
      if (retained == null || this.authorityTerminalStarted) {
        this.sentReplacementTimers.delete(key);
        return;
      }
      const retainedDeadline = this.sentReplacementDeadlines.get(key) ?? deadline;
      if (!this.enforceRetainedAuthorityBound("replacement", retained, key, retainedDeadline)) {
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
    return true;
  }

  /**
   * A continuation-ready ACK for a strictly newer complete state proves that the guest no longer needs an
   * older replacement snapshot from the same epoch. Retaining that dominated frame until its original
   * deadline only replays cross-wave traffic and can falsely terminate an otherwise converged session.
   *
   * Address order and state revision must both advance. This deliberately excludes a superseded turn ACK,
   * equal/conflicting revisions, future addresses, and every other epoch.
   */
  private releaseCausallyDominatedReplacements(
    authority: CoopTurnResolution | CoopCheckpointEnvelope,
    source: "turnResolution" | "replacement",
  ): number {
    let released = 0;
    for (const [key, retained] of this.sentReplacementCheckpoints) {
      if (!replacementIsCausallyDominatedBy(retained, authority)) {
        continue;
      }
      this.causallyRetiredReplacementAuthority.set(key, replacementAckIdentity(retained));
      while (this.causallyRetiredReplacementAuthority.size > AUTHORITY_RETIRED_REPLACEMENT_RETENTION) {
        const oldest = this.causallyRetiredReplacementAuthority.keys().next().value as string | undefined;
        if (oldest == null) {
          break;
        }
        this.causallyRetiredReplacementAuthority.delete(oldest);
      }
      this.sentReplacementCheckpoints.delete(key);
      this.sentReplacementDeadlines.delete(key);
      this.sentReplacementTimers.get(key)?.();
      this.sentReplacementTimers.delete(key);
      released++;
      coopLog(
        "stream",
        `host RELEASE causally dominated replacement key=${key} via ${source} key=${authorityKey(authority)}`,
      );
    }
    return released;
  }

  /** Drop guest-side working transactions made obsolete by the same newer full-state proof. */
  private discardCausallyDominatedGuestReplacements(authority: CoopTurnResolution | CoopCheckpointEnvelope): number {
    const discard = <T>(entries: Map<string, T>, envelopeOf: (value: T) => CoopCheckpointEnvelope): number => {
      let removed = 0;
      for (const [key, value] of entries) {
        if (!replacementIsCausallyDominatedBy(envelopeOf(value), authority)) {
          continue;
        }
        entries.delete(key);
        removed++;
      }
      return removed;
    };
    let removed = discard(this.pendingCheckpoints, value => value);
    removed += discard(this.appliedOutOfBandCheckpoints, value => value);
    removed += discard(this.pendingReplacementContinuations, value => value.envelope);
    for (const key of [...this.replacementRedeliveryRequests]) {
      const retained = this.seenReplacementAuthority.get(key)?.value;
      if (retained != null && replacementIsCausallyDominatedBy(retained, authority)) {
        this.replacementRedeliveryRequests.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      coopLog(
        "stream",
        `guest DISCARD ${removed} causally dominated replacement transaction(s) via key=${authorityKey(authority)}`,
      );
    }
    return removed;
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
    entryPresentation?: CoopBattleEvent[],
  ): void {
    const entryPresentationLength = entryPresentation?.length ?? 0;
    if (entryPresentation !== undefined && !isStrictEntryPresentation(entryPresentation)) {
      throw new Error(`refusing malformed entry presentation wave=${wave} events=${entryPresentationLength}`);
    }
    if (
      entryPresentation !== undefined
      && (authoritativeState == null || authoritativeState.wave !== wave || !isSafeAddressPart(authoritativeState.tick))
    ) {
      throw new Error(`refusing entry presentation without its exact wave-start state wave=${wave}`);
    }
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
    if (retained?.entryPresentation !== undefined) {
      if (
        entryPresentation !== undefined
        && canonicalize(retained.entryPresentation) !== canonicalize(entryPresentation)
      ) {
        coopWarn("stream", `host preserved immutable entry presentation after conflicting re-send wave=${wave}`);
      }
      // Once the post-summon prefix is sealed, its party, encounter, and state tick are one immutable
      // pre-command carrier. A later same-wave sender may re-publish it but may not pair those cosmetics
      // with a different mechanical image.
      this.transport.send(retained);
      return;
    }
    // Clone before retention: the recording array is caller-owned and continues to grow through turn 1.
    // Retained redelivery must remain the exact prefix sealed at CommandPhase, not alias later mutations.
    const resolvedEntryPresentation = entryPresentation === undefined ? undefined : structuredClone(entryPresentation);
    const message: Extract<CoopMessage, { t: "enemyPartySync" }> = {
      t: "enemyPartySync",
      wave,
      enemies,
      ...(resolvedMeType === undefined ? {} : { meType: resolvedMeType }),
      ...(resolvedBattleType === undefined ? {} : { battleType: resolvedBattleType }),
      ...(encounter === undefined ? {} : { encounter }),
      ...(authoritativeState === undefined ? {} : { authoritativeState }),
      ...(resolvedEntryPresentation === undefined ? {} : { entryPresentation: resolvedEntryPresentation }),
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
      `host SEND enemyPartySync wave=${wave} count=${enemies.length} meType=${resolvedMeType ?? "-"} `
        + `battleType=${resolvedBattleType ?? "-"} entryPresentation=${resolvedEntryPresentation?.length ?? "-"}`,
    );
    this.transport.send(message);
  }

  /** GUEST: inspect the complete wave-start state without removing the final CommandPhase seal. */
  peekEnemyPartyState(wave: number): CoopAuthoritativeBattleStateV1 | undefined {
    return this.enemyPartyStateByWave.get(wave);
  }

  /** GUEST: consume the complete state paired with this wave's enemy-party handoff, if supplied. */
  consumeEnemyPartyState(wave: number): CoopAuthoritativeBattleStateV1 | undefined {
    const state = this.enemyPartyStateByWave.get(wave);
    this.enemyPartyStateByWave.delete(wave);
    return state;
  }

  /**
   * HOST (#920): peek - WITHOUT consuming - the authoritative state this host already SENT with the
   * wave-start enemy-party handoff for `wave`. Reads the host's retained SENT message (not the guest
   * inbox), so the post-summon re-broadcast can tell whether an on-entry ability chain mutated
   * arena/forms after that pre-summon capture and re-send ONLY when something actually changed.
   */
  peekSentEnemyPartyAuthoritativeState(wave: number): CoopAuthoritativeBattleStateV1 | undefined {
    return this.sentEnemyParties.get(wave)?.authoritativeState;
  }

  /** GUEST: atomically consume the exact encounter identity paired with this wave's party. */
  consumeEnemyPartyEncounter(wave: number): CoopEncounterAuthority | undefined {
    const encounter = this.enemyPartyEncounterByWave.get(wave);
    this.enemyPartyEncounterByWave.delete(wave);
    return encounter;
  }

  /**
   * GUEST: consume the three projections of one wave-keyed enemy-party carrier together.
   *
   * Callers may inspect the returned state tick before mutating encounter/party state, which prevents an
   * obsolete party image from clearing a newer live battle before its stale state twin is rejected.
   */
  consumeEnemyPartyAuthority(wave: number): {
    enemies: CoopSerializedEnemy[] | null;
    encounter: CoopEncounterAuthority | undefined;
    state: CoopAuthoritativeBattleStateV1 | undefined;
  } {
    return {
      enemies: this.consumeEnemyParty(wave),
      encounter: this.consumeEnemyPartyEncounter(wave),
      state: this.consumeEnemyPartyState(wave),
    };
  }

  /** Consume a retained, complete Showdown entry-presentation prefix once. */
  consumeEntryPresentation(wave: number): CoopEntryPresentationPrefix | null {
    const prefix = this.entryPresentationByWave.get(wave) ?? null;
    this.entryPresentationByWave.delete(wave);
    if (prefix != null) {
      this.consumedEntryPresentationThroughWave = Math.max(this.consumedEntryPresentationThroughWave, wave);
    }
    return prefix;
  }

  /**
   * Await the retained post-summon carrier and re-request it on a bounded cadence. Unlike best-effort
   * live battleEvent packets, this complete prefix survives a drop/reconnect and cannot strand command input.
   */
  awaitEntryPresentation(
    wave: number,
    opts: { timeoutMs?: number; retryIntervalMs?: number; maxRetries?: number } = {},
  ): Promise<CoopEntryPresentationPrefix | null> {
    const buffered = this.consumeEntryPresentation(wave);
    if (buffered != null) {
      return Promise.resolve(buffered);
    }
    if (wave <= this.consumedEntryPresentationThroughWave) {
      // A reconstructed/re-entered turn-1 phase must not wait forever for a prefix this session already
      // rendered. Returning an empty exact-once prefix advances no event watermark and opens no duplicate UI.
      return Promise.resolve({ events: [], stateTick: 0 });
    }
    const stale = this.entryPresentationWaiters.get(wave);
    stale?.(null);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const retryIntervalMs = opts.retryIntervalMs ?? 5_000;
    const maxRetries = opts.maxRetries ?? 6;
    return new Promise(resolve => {
      let settled = false;
      let attempts = 0;
      let cancelTimeout: () => void = () => {};
      let cancelRetry: () => void = () => {};
      const finish = (prefix: CoopEntryPresentationPrefix | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimeout();
        cancelRetry();
        if (this.entryPresentationWaiters.get(wave) === finish) {
          this.entryPresentationWaiters.delete(wave);
        }
        if (prefix != null) {
          this.entryPresentationByWave.delete(wave);
          this.consumedEntryPresentationThroughWave = Math.max(this.consumedEntryPresentationThroughWave, wave);
        }
        resolve(prefix);
      };
      const request = () => {
        try {
          this.transport.send({ t: "requestEnemyParty", wave });
        } catch {
          // The retained host carrier or a later retry remains authoritative.
        }
      };
      const scheduleRetry = () => {
        if (settled || attempts >= maxRetries || retryIntervalMs <= 0) {
          return;
        }
        cancelRetry = this.schedule(() => {
          if (settled) {
            return;
          }
          attempts++;
          coopWarn("stream", `guest awaitEntryPresentation wave=${wave} RE-REQUEST attempt ${attempts}/${maxRetries}`);
          request();
          scheduleRetry();
        }, retryIntervalMs);
      };
      this.entryPresentationWaiters.set(wave, finish);
      cancelTimeout = this.schedule(() => finish(null), timeoutMs);
      request();
      scheduleRetry();
    });
  }

  /**
   * GUEST: retire every wave-keyed enemy-party carrier causally dominated by a newer material state.
   * A later post-summon carrier with a strictly newer tick remains admissible.
   */
  retireEnemyPartyAuthorityThrough(wave: number, tick: number): void {
    if (!Number.isSafeInteger(wave) || wave < 0 || !Number.isSafeInteger(tick) || tick < 0) {
      return;
    }
    const floor = Math.max(this.enemyPartyAuthorityFloorByWave.get(wave) ?? -1, tick);
    this.enemyPartyAuthorityFloorByWave.set(wave, floor);
    if (
      this.lastEnemyParty?.wave === wave
      && (this.lastEnemyParty.stateTick === undefined || this.lastEnemyParty.stateTick <= floor)
    ) {
      this.lastEnemyParty = null;
    }
    const retainedState = this.enemyPartyStateByWave.get(wave);
    if (retainedState == null || retainedState.tick <= floor) {
      this.enemyPartyStateByWave.delete(wave);
      this.enemyPartyEncounterByWave.delete(wave);
      this.meTypeByWave.delete(wave);
      this.battleTypeByWave.delete(wave);
    }
    while (this.enemyPartyAuthorityFloorByWave.size > 4) {
      const oldestWave = Math.min(...this.enemyPartyAuthorityFloorByWave.keys());
      this.enemyPartyAuthorityFloorByWave.delete(oldestWave);
    }
    coopLog("stream", `guest retired enemyParty authority wave=${wave} through tick=${floor}`);
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
    boundary: CoopTurnBoundaryIdentity = { mysteryBattle: false },
  ): boolean {
    const revision = authoritativeState.tick;
    const invalidEventIndex = events.findIndex(event => !isStrictBattleEvent(event));
    if (invalidEventIndex >= 0) {
      throw new Error(
        `refusing malformed turn event index=${invalidEventIndex} e=${epoch} wave=${wave} turn=${turn} `
          + `event=${JSON.stringify(events[invalidEventIndex])}`,
      );
    }
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
    // authority-v2 turn/command CUTOVER (surface 1). Two disjoint paths, gated on the cutover being active:
    //   - CUTOVER ACTIVE: commit the v2 TURN_COMMIT as the SOLE authority FIRST, then make the legacy carrier
    //     COSMETIC (sent once, never retained/resent/acked/applied). A failed V2 commit is fatal: falling back
    //     per turn would let transport timing choose between an untyped legacy successor and the global log.
    //   - NOT ACTIVE (legacy or shadow-only): the EXACT original ordering (retain -> send -> shadow tap), so a
    //     capability-off / shadow-only session is byte-identical to the pre-cutover build.
    if (isCoopV2TurnCutoverActive()) {
      const v2Committed = this.emitCoopV2TurnAuthority(
        epoch,
        wave,
        turn,
        events,
        checkpoint,
        checksum,
        preimage,
        fullField,
        authoritativeState,
        boundary,
      );
      if (!v2Committed) {
        const reason = `Authority V2 could not commit turn ${wave}:${turn}; refusing legacy turn authority.`;
        coopWarn("v2-turn", reason);
        this.beginAuthorityTerminal({
          epoch,
          wave,
          turn,
          revision,
          boundary: "turnResolution",
          reason,
          failureId: `v2-turn-commit:${epoch}:${wave}:${turn}:${revision}`,
        });
        return false;
      }
      if (!this.retainAndRetryTurnCommit(commit, true)) {
        coopWarn("stream", `host WITHHOLD turn commit e=${epoch} wave=${wave} turn=${turn}: authority terminal active`);
        return false;
      }
      this.transport.send(commit);
      return true;
    }
    if (!this.retainAndRetryTurnCommit(commit)) {
      coopWarn("stream", `host WITHHOLD turn commit e=${epoch} wave=${wave} turn=${turn}: authority terminal active`);
      return false;
    }
    this.transport.send(commit);
    // Shadow parity tap AFTER the legacy send (unchanged position) - a pure no-op unless a harness is active.
    this.emitCoopV2TurnAuthority(
      epoch,
      wave,
      turn,
      events,
      checkpoint,
      checksum,
      preimage,
      fullField,
      authoritativeState,
      boundary,
    );
    return true;
  }

  /**
   * authority-v2 surface 1: build the v2 TURN_COMMIT input from the just-published turn image and drive the
   * v2 authority path. In CUTOVER mode (authority.v2turn negotiated) the commit is the SOLE authority for the
   * turn and this returns whether it committed; in shadow-only mode it runs the parity tap and returns false
   * (legacy stays the authority). A COMMAND successor is stated only when the settled state has an immediate
   * command frontier. Faint boundaries state an exact ordered replacement control when one is executable;
   * every other non-command boundary is closed by the adapter's explicit ordered successor wait.
   */
  private emitCoopV2TurnAuthority(
    epoch: number,
    wave: number,
    turn: number,
    events: CoopBattleEvent[],
    checkpoint: CoopBattleCheckpoint,
    checksum: string,
    preimage: string,
    fullField: CoopFullMonSnapshot[],
    authoritativeState: CoopAuthoritativeBattleStateV1,
    boundary: CoopTurnBoundaryIdentity,
  ): boolean {
    const cutoverActive = isCoopV2TurnCutoverActive();
    if (!cutoverActive && !isCoopV2ShadowActive()) {
      return false;
    }
    const hasDeferredWaveAdvance = boundary.deferredWaveOutcome === "win";
    if (hasDeferredWaveAdvance && boundary.mysteryBattle) {
      coopWarn("v2-turn", "host refused conflicting Mystery and deferred-wave turn boundary");
      return false;
    }
    // The runtime's already-staged transition owns this choice. The state image remains the complete
    // material payload, but it must not overrule a VictoryPhase decision by re-guessing COMMAND here.
    const hasImmediateCommand = !hasDeferredWaveAdvance && hasCoopV2ImmediateCommandSuccessor(authoritativeState);
    const commandFrontier = hasImmediateCommand
      ? resolveCoopV2CommandFrontier(authoritativeState)
      : { commands: [], unresolved: [] };
    if (hasImmediateCommand && (commandFrontier.commands.length === 0 || commandFrontier.unresolved.length > 0)) {
      if (commandFrontier.unresolved.length > 0) {
        const unresolved = commandFrontier.unresolved
          .map(issue => `${issue.seat.side}:bi${issue.seat.bi}:pokemon${issue.seat.pokemonId}:${issue.reason}`)
          .join(",");
        coopWarn("v2-turn", `host refused incomplete COMMAND frontier [${unresolved}]`);
      }
      return false;
    }
    // Cutover surface 1: the v2 material must carry the COMPLETE legacy turn resolution (not just the
    // numeric checkpoint), so a guest applying it can reconstruct the exact carrier its REAL progression
    // (CoopReplayTurnPhase -> CoopFinalizeTurnPhase) awaits - making the now-cosmetic, unretained legacy
    // carrier's loss/race non-fatal, and healing the terrain/arenaTags/field companion state the numeric
    // checkpoint omits. Identical to the legacy image, so shadow parity still compares like-for-like.
    const capture: TurnResolutionImage = {
      turnResolution: events,
      checkpoint,
      checksum,
      preimage,
      fullField,
      authoritativeState,
      epoch,
      wave,
      turn,
      revision: authoritativeState.tick,
    };
    // State the COMPLETE human command frontier through the single canonical mapper shared with
    // post-replacement commits. This includes Showdown's explicitly-owned authoritative enemy side while
    // omitting ordinary AI enemies; an unowned human seat fails the whole commit instead of being guessed.
    const completeCommands = [...commandFrontier.commands];
    const replacementControl =
      hasImmediateCommand || hasDeferredWaveAdvance
        ? null
        : resolveCoopV2ReplacementControl(epoch, authoritativeState, events);
    const operationId = `TURN/e${epoch}/w${wave}/t${turn}`;
    const deferredWaveWait = deferredCoopV2WaveSuccessorWait(operationId, epoch, wave, turn, boundary);
    // A Mystery-spawned battle terminates through the retained ME transaction, not WAVE_ADVANCE. That
    // transaction deliberately lives at the encounter's wave/turn-0 address even though the battle may end
    // on turn N. State the inverse edge exactly here; a generic turn-N wait correctly rejects turn 0 and used
    // to terminate an otherwise checksum-converged run at the post-battle reward handoff (gate C1 wave 32).
    const nextSuccessorWait: Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }> | null =
      deferredWaveWait
      ?? (!hasImmediateCommand
      && replacementControl == null
      && boundary.mysteryBattle
      && authoritativePartyIsDefeated(authoritativeState.enemyParty)
      && !authoritativePartyIsDefeated(authoritativeState.playerParty)
        ? {
            kind: "AWAIT_SUCCESSOR",
            afterOperationId: operationId,
            epoch,
            wave,
            turn,
            allowedKinds: ["INTERACTION_COMMIT"],
            allowedInteractionAddresses: [{ surfaceClass: "op:me", operationKind: "ME_TERMINAL", wave, turn: 0 }],
            allowNextWaveStart: false,
            expectedOperationId: null,
          }
        : null);
    const input: CoopV2ShadowTurnTap = {
      operationId,
      capture,
      nextCommandFrontier:
        completeCommands.length === 0
          ? null
          : {
              epoch,
              wave,
              resolvedTurn: turn,
              commands: completeCommands,
            },
      nextReplacementControl: replacementControl,
      nextSuccessorWait,
      // Deliverable 1: fingerprint the LEGACY turn image (the resolution + checkpoint + companions legacy just
      // committed) through the SAME turn digest so parity compares like-for-like (v2 entry digest vs
      // v2-digest-of-legacy-image); the full-state checksum stays as the raw legacy token for the log.
      legacyImage: capture,
      legacyDigest: checksum,
      successorSeatSource:
        replacementControl != null || completeCommands.length === 0 ? "none-non-command-boundary" : "owner-field",
    };
    if (cutoverActive) {
      // CUTOVER: commit the v2 TURN_COMMIT as the sole authority. A non-null entry commits; null is a fatal
      // authority refusal handled by emitTurn. Per-turn legacy fallback would make this a mixed authority graph.
      const committed = getActiveCoopV2TurnCutover()?.commitHostTurn(input) ?? null;
      return committed != null;
    }
    // SHADOW-ONLY: the tap computes + compares alongside legacy; legacy stays the authority.
    tapCoopV2ShadowTurnCommit(input);
    return false;
  }

  /** Newest checkpoint capable of completing the exact replay-turn park, including a bounded N±1 replacement. */
  private checkpointEntryForTurn(turn: number, sourceWave?: number): [string, CoopCheckpointEnvelope] | undefined {
    const waitedAddress = this.currentAuthorityAddress(turn, sourceWave);
    if (this.authorityContext == null) {
      return [...this.pendingCheckpoints.entries()].reverse().find(([, envelope]) => envelope.turn === turn);
    }
    if (waitedAddress == null) {
      return;
    }
    return [...this.pendingCheckpoints.entries()]
      .filter(
        ([, envelope]) =>
          sameTurnAddress(envelope, waitedAddress)
          || (envelope.reason === "replacement"
            && envelope.epoch === waitedAddress.epoch
            && envelope.wave === waitedAddress.wave
            && (envelope.turn === waitedAddress.turn + 1 || envelope.turn + 1 === waitedAddress.turn)),
      )
      .sort((left, right) => right[1].revision - left[1].revision)[0];
  }

  /**
   * HOST: emit ONE visible battle event LIVE (#633, animation layer), the instant the host records
   * it, so the guest can WATCH the fight unfold with minimal lag instead of waiting for the whole
   * turn to batch at turn-end. `seq` is a per-turn monotonic index the host supplies (so the guest
   * replays in order + de-dupes against the turn-end batch). PRESENTATION ONLY - the turn-end
   * checkpoint is still the source of truth, so a dropped / reordered live event only stutters.
   */
  emitEvent(epoch: number, wave: number, turn: number, seq: number, event: CoopBattleEvent): void {
    if (this.authorityTerminalStarted) {
      return;
    }
    if (!isStrictBattleEvent(event)) {
      coopWarn(
        "replay",
        `host WITHHOLD malformed live battleEvent e=${epoch} wave=${wave} turn=${turn} seq=${seq} `
          + `event=${JSON.stringify(event)}`,
      );
      return;
    }
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
    if (this.authorityTerminalStarted) {
      return;
    }
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
    // Retain every addressed revision until its exact continuation-ready ACK. Material and presentation
    // evidence are diagnostic progress only. The map is intentionally not "latest only": overlapping
    // replacement transactions remain independently replayable.
    if (reason === "replacement" && !this.retainAndRetryReplacement(envelope)) {
      coopWarn(
        "checkpoint",
        `host WITHHOLD replacement e=${epoch} wave=${wave} turn=${turn}: authority terminal active`,
      );
      return;
    }
    this.transport.send({
      t: "battleCheckpoint",
      ...envelope,
    });
  }

  /** GUEST: request the host's retained complete replacement frame after a failed transactional apply. */
  requestReplacementCheckpoint(envelope: CoopCheckpointEnvelope): void {
    if (this.authorityTerminalStarted) {
      return;
    }
    this.replacementRedeliveryRequests.add(authorityKey(envelope));
    if (suppressesLegacyReplacementRequest(activeCoopReplacementAuthorityMode())) {
      // Keep the local re-open latch: when the V2 delivery lease redelivers this immutable entry, the
      // compatibility transaction must re-enter its safe consumer after a failed apply. Only the legacy
      // wire request is retired; the V2 authority log already owns reliable redelivery.
      coopLog(
        "v2-replacement",
        `guest awaits retained V2 redelivery for failed replacement key=${authorityKey(envelope)}`,
      );
      return;
    }
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

  private sendTurnCommitRequest(request: TurnCommitRequest): void {
    this.transport.send({ t: "requestTurnCommit", ...request });
  }

  private clearTurnCommitRequest(key: string): void {
    this.requestedTurnCommits.delete(key);
    this.turnRequestTimers.get(key)?.();
    this.turnRequestTimers.delete(key);
  }

  private clearTurnCommitRequestsAtAddress(address: CoopTurnAddress): void {
    for (const [key, request] of this.requestedTurnCommits) {
      if (sameTurnAddress(request, address)) {
        this.clearTurnCommitRequest(key);
      }
    }
  }

  private clearSupersededTurnCommitRequests(address: {
    epoch: number;
    wave: number;
    turn: number;
    revision: number;
  }): void {
    for (const [key, request] of this.requestedTurnCommits) {
      if (
        sameTurnAddress(request, address)
        && (request.revision === undefined || request.revision < address.revision)
      ) {
        this.clearTurnCommitRequest(key);
      }
    }
  }

  /** GUEST: keep requesting one exact logical turn until its verified ACK clears the request. */
  requestTurnCommit(epoch: number, wave: number, turn: number, revision?: number): void {
    if (this.authorityTerminalStarted) {
      return;
    }
    // authority-v2 turn CUTOVER: the v2 authority log owns tail requests + redelivery for the turn, and the
    // guest applies the turn through the v2 replica pipeline. The legacy requestTurnCommit RE-REQUEST loop
    // must NOT run for a negotiated session (the frozen "no second authority" rule) - a lost cosmetic carrier
    // only stutters presentation; the v2 log redelivers the authoritative entry. No-op here, byte-identical
    // to legacy when the cutover is not active.
    if (isCoopV2TurnCutoverActive()) {
      return;
    }
    const request = { epoch, wave, turn, ...(revision === undefined ? {} : { revision }) };
    const key = turnCommitRequestKey(request);
    if (revision !== undefined) {
      // The exact commit replaces only the open-ended discovery request. Other exact revisions keep their
      // own retry/ACK lifecycle until each is explicitly superseded or reaches continuation-ready.
      this.clearTurnCommitRequest(turnCommitRequestKey({ epoch, wave, turn }));
    }
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

  /** GUEST: explicitly re-open one immutable commit observer after transactional application failed. */
  requestTurnCommitRetry(epoch: number, wave: number, turn: number, revision: number): void {
    if (this.authorityTerminalStarted || !isSafeAddressPart(revision, false)) {
      return;
    }
    this.turnRedeliveryRequests.add(authorityKey({ epoch, wave, turn, revision }));
    this.requestTurnCommit(epoch, wave, turn, revision);
  }

  /**
   * GUEST (Track R replay->command PIVOT): cancel any pending turn-commit REQUEST + its retry loop for this
   * exact turn address. When a mid-turn replacement fills the guest's OWN slot, its parked
   * CoopReplayTurnPhase (which armed `requestTurnCommit(turn)` while passively awaiting the host's turn
   * resolution) PIVOTS to opening the guest's own CommandPhase - the guest is now going to PRODUCE that
   * turn's command, not passively await it. Leaving the request armed leaves the guest pinging the host
   * `requestTurnCommit -> turnCommitPending` forever while the host is (correctly) awaiting the guest's
   * command (the observed barrier / turn-commit softlock shape). The re-queued CoopReplayTurnPhase re-arms
   * the await legitimately AFTER the command is broadcast, so this only silences the premature request at
   * the pivot. Idempotent; a no-op when no request is pending.
   */
  cancelPendingTurnCommitRequests(epoch: number, wave: number, turn: number): void {
    this.clearTurnCommitRequestsAtAddress({ epoch, wave, turn });
  }

  onTurnCommit(handler: (resolution: CoopTurnResolution) => void): () => void {
    this.turnCommitHandlers.add(handler);
    return () => this.turnCommitHandlers.delete(handler);
  }

  /**
   * Read the furthest local renderer evidence already emitted for this exact immutable turn.
   *
   * A retained V2 retry can revisit a live finalizer while its async presentation proof is settling.
   * The phase uses this read-only cursor to resume after the completed stage instead of re-applying
   * material or replaying an older ACK. Identity is checked against the immutable admission ledger;
   * a foreign or merely same-address carrier never inherits another commit's progress.
   */
  turnCommitAckStage(resolution: CoopTurnResolution): CoopAuthorityAckStage | null {
    const key = authorityKey(resolution);
    const admitted = this.seenTurnAuthority.get(key);
    if (admitted == null || !sameAuthorityAckIdentity(admitted.value, resolution)) {
      return null;
    }
    return this.ackedTurnCommits.get(key)?.stage ?? null;
  }

  private failLocalAckProgression(
    boundary: "turnResolution" | "replacement",
    address: { epoch: number; wave: number; turn: number; revision: number },
    reason: string,
  ): void {
    coopWarn("stream", reason);
    this.beginAuthorityTerminal({
      ...address,
      boundary,
      reason,
      failureId: `ack-stage:${boundary}:${authorityKey(address)}`,
    });
  }

  private failHostAckProgression(
    boundary: "turnResolution" | "replacement",
    received: { epoch: number; wave: number; turn: number; revision: number },
    reason: string,
  ): void {
    const fallback =
      boundary === "turnResolution"
        ? [...this.sentTurnCommits.values()].at(-1)
        : [...this.sentReplacementCheckpoints.values()].at(-1);
    const address =
      fallback
      ?? (isSafeAddressPart(received.epoch, false)
      && isSafeAddressPart(received.wave, false)
      && isSafeAddressPart(received.turn, false)
      && isSafeAddressPart(received.revision, false)
        ? received
        : this.currentAuthorityAddress() == null
          ? null
          : { ...this.currentAuthorityAddress()!, revision: Math.max(1, this.authorityFailureRevision + 1) });
    if (address == null) {
      coopWarn("stream", `${reason} (no authentic authority address remained for shared terminal)`);
      return;
    }
    coopWarn("stream", reason);
    this.beginAuthorityTerminal({
      epoch: address.epoch,
      wave: address.wave,
      turn: address.turn,
      revision: address.revision,
      boundary,
      reason,
      failureId: `ack-stage:${boundary}:${authorityKey(address)}`,
    });
  }

  acknowledgeTurnCommit(
    resolution: CoopTurnResolution,
    stage: CoopAuthorityAckStage,
    superseding?: CoopCheckpointEnvelope,
  ): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const ack: Extract<CoopMessage, { t: "turnCommitAck" }> = {
      t: "turnCommitAck",
      epoch: resolution.epoch,
      wave: resolution.wave,
      turn: resolution.turn,
      revision: resolution.revision,
      checkpointTick: resolution.checkpoint.tick as number,
      stateTick: resolution.authoritativeState.tick,
      checksum: resolution.checksum,
      stage,
      status: superseding == null ? "applied" : "superseded",
      ...(superseding == null
        ? {}
        : {
            supersededByRevision: superseding.revision,
            supersededByChecksum: superseding.checksum,
          }),
    };
    const key = authorityKey(resolution);
    const seen = this.seenTurnAuthority.get(key);
    if (
      !isAuthorityAckStage(stage)
      || seen == null
      || !sameAuthorityAckIdentity(seen.value, resolution)
      || (superseding != null
        && (superseding.reason !== "replacement"
          || superseding.epoch !== resolution.epoch
          || superseding.wave !== resolution.wave
          || (superseding.turn !== resolution.turn && superseding.turn !== resolution.turn + 1)
          || superseding.revision <= resolution.revision))
    ) {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn ACK evidence did not belong to exact admitted authority ${key}.`,
      );
      return false;
    }
    const canonical = canonicalize(ack);
    const prior = this.ackedTurnCommits.get(key);
    if (
      prior != null
      && (prior.value.status !== ack.status
        || prior.value.supersededByRevision !== ack.supersededByRevision
        || prior.value.supersededByChecksum !== ack.supersededByChecksum)
    ) {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn ACK supersession evidence changed between stages at ${key}.`,
      );
      return false;
    }
    const progress = classifyAckProgress(prior, stage, canonical);
    if (progress === "invalid") {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn ACK stage ${stage} skipped/regressed/conflicted at ${key} (prior=${prior?.stage ?? "none"}).`,
      );
      return false;
    }
    if (progress === "advance") {
      rememberAckEvidence(this.ackedTurnCommits, key, { stage, canonical, value: ack });
    }
    this.turnRedeliveryRequests.delete(key);
    if (stage === "materialApplied") {
      // Material evidence suppresses duplicate reconstruction locally, but request/retry/host retention stay
      // alive until the exact continuation surface proves ready.
      discardAuthorityThrough(this.inbox, resolution);
    } else if (stage === "continuationReady") {
      this.pendingTurnContinuations.delete(key);
      this.clearTurnCommitRequest(turnCommitRequestKey(resolution));
      if (superseding == null) {
        this.discardCausallyDominatedGuestReplacements(resolution);
      }
    }
    this.transport.send(ack);
    coopLog(
      "stream",
      `guest ACK turn stage=${stage} e=${resolution.epoch} wave=${resolution.wave} turn=${resolution.turn} rev=${resolution.revision}`,
    );
    return true;
  }

  acknowledgeReplacement(envelope: CoopCheckpointEnvelope, stage: CoopAuthorityAckStage): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
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
      stage,
    };
    const key = authorityKey(envelope);
    const seen = this.seenReplacementAuthority.get(key);
    if (
      !isAuthorityAckStage(stage)
      || envelope.reason !== "replacement"
      || seen == null
      || !sameAuthorityAckIdentity(seen.value, envelope)
    ) {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement ACK evidence did not belong to exact admitted authority ${key}.`,
      );
      return false;
    }
    const canonical = canonicalize(ack);
    const prior = this.ackedReplacementCommits.get(key);
    const progress = classifyAckProgress(prior, stage, canonical);
    if (progress === "invalid") {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement ACK stage ${stage} skipped/regressed/conflicted at ${key} (prior=${prior?.stage ?? "none"}).`,
      );
      return false;
    }
    if (progress === "advance") {
      rememberAckEvidence(this.ackedReplacementCommits, key, { stage, canonical, value: ack });
    }
    if (stage === "materialApplied" && !this.markAuthoritativeReplacementFinalized(envelope)) {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement materialApplied could not prove exact installed authority ${key}.`,
      );
      return false;
    }
    this.replacementRedeliveryRequests.delete(key);
    if (stage === "continuationReady") {
      this.pendingReplacementContinuations.delete(key);
      this.discardCausallyDominatedGuestReplacements(envelope);
    }
    this.transport.send(ack);
    coopLog(
      "stream",
      `guest ACK replacement stage=${stage} e=${envelope.epoch} wave=${envelope.wave} turn=${envelope.turn} rev=${envelope.revision}`,
    );
    return true;
  }

  /**
   * Complete older replacement ACK chains from a separately-retained operation's stronger state proof.
   *
   * Callers may use this only after the operation's exact authoritative DATA applied and its real public
   * continuation opened. This closes the live race where a replacement checkpoint arrives after the same
   * replacement was already incorporated into WAVE_ADVANCE: the late checkpoint cannot safely reopen a
   * replay phase, but leaving it unacknowledged makes the host retry until terminal failure.
   */
  acknowledgeReplacementsSubsumedByOperation(authority: CoopAuthoritativeEnvelopeV1): number {
    if (this.authorityTerminalStarted || authority.pendingOperation?.kind !== "WAVE_ADVANCE") {
      return 0;
    }
    const candidates = [...this.seenReplacementAuthority.values()]
      .map(seen => copyAdmittedAuthority(seen))
      .filter(envelope => replacementIsSubsumedByOperation(envelope, authority))
      .sort(
        (left, right) =>
          left.wave - right.wave
          || left.turn - right.turn
          || left.authoritativeState.tick - right.authoritativeState.tick
          || left.revision - right.revision,
      );
    let completed = 0;
    for (const envelope of candidates) {
      const key = authorityKey(envelope);
      const prior = this.ackedReplacementCommits.get(key);
      const firstStage =
        prior == null ? 0 : prior.stage === "materialApplied" ? 1 : prior.stage === "presentationReady" ? 2 : 3;
      const stages: readonly CoopAuthorityAckStage[] = ["materialApplied", "presentationReady", "continuationReady"];
      for (let index = firstStage; index < stages.length; index++) {
        if (!this.acknowledgeReplacement(envelope, stages[index])) {
          return completed;
        }
      }
      if (firstStage === stages.length && !this.acknowledgeReplacement(envelope, "continuationReady")) {
        return completed;
      }
      this.pendingCheckpoints.delete(bufferedAuthorityKey("replacement", envelope));
      this.appliedOutOfBandCheckpoints.delete(bufferedAuthorityKey("replacement", envelope));
      completed++;
      coopLog(
        "checkpoint",
        `guest ACK replacement through newer operation state key=${key} operation=${authority.pendingOperation?.kind ?? "none"} `
          + `stateTick=${authority.authoritativeState.tick}`,
      );
    }
    return completed;
  }

  registerTurnContinuation(
    resolution: CoopTurnResolution,
    superseding: CoopCheckpointEnvelope | undefined,
    expectation: CoopAuthorityContinuationExpectation,
  ): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const key = authorityKey(resolution);
    if (this.ackedTurnCommits.get(key)?.stage !== "presentationReady") {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn continuation registered before presentationReady at ${key}.`,
      );
      return false;
    }
    const exactExpectation =
      expectation.epoch === resolution.epoch
      && expectation.wave === resolution.wave
      && (expectation.kind === "sharedBoundary"
        ? expectation.turn === resolution.turn
        : expectation.turn === resolution.turn + 1);
    if (!exactExpectation) {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn continuation registered with a wrong authority address at ${key}.`,
      );
      return false;
    }
    const pending: PendingTurnContinuation = {
      resolution,
      expectation,
      ...(superseding == null ? {} : { superseding }),
    };
    const prior = this.pendingTurnContinuations.get(key);
    if (prior != null && canonicalize(prior) !== canonicalize(pending)) {
      this.failLocalAckProgression(
        "turnResolution",
        resolution,
        `Turn continuation expectation changed after registration at ${key}.`,
      );
      return false;
    }
    this.pendingTurnContinuations.set(key, pending);
    return true;
  }

  /** Record the exact retained terminal that can authorize an early command prediction at wave+1 turn 1. */
  noteWaveAdvanceAdmitted(epoch: number, wave: number): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const key = `${epoch}:${wave}`;
    if (this.admittedWaveAdvanceContinuations.has(key)) {
      return false;
    }
    this.admittedWaveAdvanceContinuations.add(key);
    if (this.admittedWaveAdvanceContinuations.size > 512) {
      this.admittedWaveAdvanceContinuations.delete(this.admittedWaveAdvanceContinuations.values().next().value!);
    }
    coopLog("stream", `guest admitted WAVE_ADVANCE continuation e=${epoch} wave=${wave}`);
    return true;
  }

  registerReplacementContinuation(
    envelope: CoopCheckpointEnvelope,
    expectation: CoopAuthorityContinuationExpectation,
  ): boolean {
    if (this.authorityTerminalStarted) {
      return false;
    }
    const key = authorityKey(envelope);
    if (this.ackedReplacementCommits.get(key)?.stage !== "presentationReady") {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement continuation registered before presentationReady at ${key}.`,
      );
      return false;
    }
    if (
      expectation.kind !== "command"
      || expectation.epoch !== envelope.epoch
      || expectation.wave !== envelope.wave
      || expectation.turn !== envelope.turn
    ) {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement continuation registered with a wrong authority address at ${key}.`,
      );
      return false;
    }
    const pending = { envelope, expectation };
    const prior = this.pendingReplacementContinuations.get(key);
    if (prior != null && canonicalize(prior) !== canonicalize(pending)) {
      this.failLocalAckProgression(
        "replacement",
        envelope,
        `Replacement continuation expectation changed after registration at ${key}.`,
      );
      return false;
    }
    this.pendingReplacementContinuations.set(key, pending);
    return true;
  }

  private continuationMatches(
    expectation: CoopAuthorityContinuationExpectation,
    surface: CoopAuthorityContinuationSurface,
    current: CoopTurnAddress,
  ): boolean {
    if (current.epoch !== expectation.epoch) {
      return false;
    }
    if (expectation.kind === "command") {
      // Turn finalization can finish before the host's wave-end carrier reaches the guest. In that race the
      // best prediction is "next command", but the battle can subsequently open the reward UI at that exact
      // next address. Both are real, renderer-active public continuation surfaces; the full address—not the
      // early prediction—must decide whether authority retention can be released.
      return (
        (surface === "command" || surface === "rendererWait" || surface === "sharedInput")
        && ((current.wave === expectation.wave && current.turn === expectation.turn)
          || (this.admittedWaveAdvanceContinuations.has(`${expectation.epoch}:${expectation.wave}`)
            && current.wave === expectation.wave + 1
            && current.turn === 1))
      );
    }
    if (surface === "terminal") {
      return current.wave === expectation.wave && current.turn >= expectation.turn;
    }
    // A resolved wave may expose a reward/map input on the old battle shell or reach the next command
    // surface after a no-shop tail.  Within the source wave, reject an earlier turn's still-open UI; in
    // the immediate successor, only turn 1 is the addressed continuation after the battle turn resets.
    if (surface !== "sharedInput" && surface !== "command") {
      return false;
    }
    return current.wave === expectation.wave
      ? current.turn >= expectation.turn
      : current.wave === expectation.wave + 1 && current.turn === 1;
  }

  /**
   * Called only after a real UI handler/terminal phase has opened. Every matching presentation-complete
   * transaction emits its final stage; an unrelated or early surface cannot release authority retention.
   */
  notifyContinuationSurface(surface: CoopAuthorityContinuationSurface): number {
    if (this.authorityTerminalStarted) {
      return 0;
    }
    const current = this.currentAuthorityAddress();
    if (current == null) {
      return 0;
    }
    const waiting = this.pendingReplacementContinuations.size + this.pendingTurnContinuations.size;
    let released = 0;
    for (const pending of [...this.pendingReplacementContinuations.values()]) {
      if (!this.continuationMatches(pending.expectation, surface, current)) {
        continue;
      }
      if (this.acknowledgeReplacement(pending.envelope, "continuationReady")) {
        released++;
      }
    }
    for (const pending of [...this.pendingTurnContinuations.values()]) {
      if (!this.continuationMatches(pending.expectation, surface, current)) {
        continue;
      }
      if (this.acknowledgeTurnCommit(pending.resolution, "continuationReady", pending.superseding)) {
        this.markAuthoritativeTurnFinalized(pending.resolution);
        released++;
      }
    }
    if (waiting > 0) {
      coopLog(
        "stream",
        `guest continuation surface=${surface} e=${current.epoch} wave=${current.wave} turn=${current.turn} `
          + `waiting=${waiting} released=${released}`,
      );
    }
    return released;
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
      ...failure,
      // Keep the wire discriminator after the defensive spread. TypeScript excludes `t` from
      // `failure`, but retained wire objects are structurally compatible and may carry extra runtime
      // properties; terminal framing must remain correct under that input too.
      t: "authorityFailure",
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
        const pendingBeforeSend = this.pendingAuthorityFailure;
        if (pendingBeforeSend == null || pendingBeforeSend.message.failureId !== message.failureId) {
          return;
        }
        this.transport.send(message);
        // A loopback/test transport may synchronously deliver the peer ACK during send(). Never arm an
        // orphan retry after that exact ACK already resolved and cleared the fatal transaction.
        const pending = this.pendingAuthorityFailure;
        if (pending == null || pending.message.failureId !== message.failureId) {
          return;
        }
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

  private mintRecoveryTicket(reason: CoopRecoveryReason, seq: number): CoopRecoveryTicketV1 | null {
    const binding = this.currentRecoveryBinding();
    const frontier = this.currentStateSyncAddress();
    if (binding == null || frontier == null || binding.sessionEpoch !== frontier.epoch) {
      return null;
    }
    return {
      version: 1,
      requestId: `${binding.sessionId}:m${binding.membershipRevision}:s${binding.fromSeatId}:g${binding.connectionGeneration}:r${seq}`,
      seq,
      reason,
      policy: "exact",
      binding,
      frontier,
    };
  }

  private captureRecoveryProof(
    ticket: CoopRecoveryTicketV1,
    input: CoopRecoveryCaptureInput,
    localTicket: boolean,
  ): CoopRecoveryCaptureV1 | null {
    const binding = this.currentRecoveryBinding();
    const frontier = this.currentStateSyncAddress();
    const ticketIsCurrent = localTicket
      ? this.localRecoveryTicketIsCurrent(ticket)
      : this.peerRecoveryTicketIsCurrent(ticket);
    if (
      !ticketIsCurrent
      || binding == null
      || frontier == null
      || input.wave !== ticket.frontier.wave
      || input.turn !== ticket.frontier.turn
      || !Number.isSafeInteger(input.stateTick)
      || input.stateTick < 0
      || typeof input.controlDigest !== "string"
      || input.controlDigest.length === 0
    ) {
      return null;
    }
    return {
      version: 1,
      binding,
      frontier,
      stateTick: input.stateTick,
      controlDigest: input.controlDigest,
    };
  }

  /** HOST: send only the exact snapshot captured for this authenticated request ticket. */
  sendStateSync(blob: string, ticket: CoopRecoveryTicketV1, input: CoopRecoveryCaptureInput): boolean {
    const captured = this.captureRecoveryProof(ticket, input, false);
    if (captured == null) {
      this.sendStateSyncUnavailable(ticket, "superseded");
      return false;
    }
    coopLog("resync", `host SEND stateSync id=${ticket.requestId} blobLen=${blob.length}`);
    this.transport.send({ t: "stateSync", ticket, captured, blob });
    return true;
  }

  /** HOST: explicitly close a valid request that cannot be captured at its exact frontier. */
  sendStateSyncUnavailable(ticket: CoopRecoveryTicketV1, reason: CoopStateSyncUnavailableReason): void {
    if (!validRecoveryTicket(ticket)) {
      return;
    }
    const binding = this.currentRecoveryBinding();
    const frontier = this.currentStateSyncAddress();
    const current = binding == null || frontier == null ? null : { binding, frontier };
    this.transport.send({ t: "stateSyncUnavailable", ticket, reason, current });
  }

  /** HOST: push a heavy snapshot under its own exact addressed durability ticket. */
  sendDurabilitySnapshot(blob: string, input: CoopRecoveryCaptureInput): boolean {
    const ticket = this.mintRecoveryTicket("durability-gap", ++this.durabilitySnapshotSeq);
    if (ticket == null) {
      return false;
    }
    const captured = this.captureRecoveryProof(ticket, input, true);
    if (captured == null) {
      return false;
    }
    this.transport.send({ t: "durabilityStateSync", ticket, captured, blob });
    return true;
  }

  /** GUEST: install the production live apply callback for addressed deep-gap snapshot pushes. */
  onDurabilitySnapshot(handler: (result: CoopStateSyncResult) => void): void {
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

  /** HOST: subscribe to already-authenticated exact recovery requests. */
  onStateSyncRequest(handler: (ticket: CoopRecoveryTicketV1) => void): void {
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
   * GUEST park signal (depth-lane learn-move deadlock): whether ANY {@linkcode awaitEnemyParty} is
   * currently in flight - i.e. the guest renderer is PARKED at a cross-wave encounter boundary awaiting
   * the host's authoritative enemy material. A waiter exists in {@linkcode enemyPartyWaiters} for exactly
   * the window an EncounterPhase.start is blocked inside its adopt-and-wait, so a `true` here means the
   * local phase queue cannot drain until that party arrives. Used by the learn-move-forward listener to
   * decide whether a queue-owned CoopReplayLearnMovePhase would strand behind the parked renderer (it
   * would) and must instead open INLINE over it. Pure read, no mutation.
   */
  hasPendingEnemyPartyWait(): boolean {
    return this.enemyPartyWaiters.size > 0;
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
    discardAuthorityThrough(this.pendingCheckpoints, entry[1]);
    return entry[1];
  }

  /** Inspect, but do not consume, the latest authoritative checkpoint envelope. */
  peekCheckpoint(): CoopCheckpointEnvelope | null {
    return this.currentCheckpointEntry()?.[1] ?? null;
  }

  /** Inspect the checkpoint that can wake one exact replay turn without broadening the ambient inbox. */
  peekCheckpointForTurn(turn: number, sourceWave?: number): CoopCheckpointEnvelope | null {
    return this.checkpointEntryForTurn(turn, sourceWave)?.[1] ?? null;
  }

  /** Consume only the checkpoint selected for one exact replay-turn boundary. */
  consumeCheckpointForTurn(turn: number, sourceWave?: number): CoopCheckpointEnvelope | null {
    const entry = this.checkpointEntryForTurn(turn, sourceWave);
    if (entry == null) {
      return null;
    }
    discardAuthorityThrough(this.pendingCheckpoints, entry[1]);
    return entry[1];
  }

  /** Record an out-of-band envelope only after its numeric/full state applied successfully. */
  retainAppliedOutOfBandCheckpoint(checkpoint: CoopCheckpointEnvelope): void {
    const key = bufferedAuthorityKey("replacement", checkpoint);
    if (this.appliedOutOfBandCheckpoints.has(key)) {
      return;
    }
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
    discardAuthorityThrough(this.appliedOutOfBandCheckpoints, selected[1]);
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
  consumeLiveEvents(turn: number, sourceWave?: number): { seq: number; event: CoopBattleEvent }[] {
    const entry = this.liveTurnEntry(turn, sourceWave);
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
  consumeLiveEventsFrom(turn: number, fromSeq: number, sourceWave?: number): CoopBattleEvent[] {
    const entry = this.liveTurnEntry(turn, sourceWave);
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
    if (run.length > 0) {
      // Advance the SHARED per-turn render watermark: these positions are being presented now (the caller
      // renders the returned run). A duplicate replay phase for the same turn then finds them already
      // covered and does not re-render them via the turn-end batch fill (#822 double-render).
      this.noteRenderedThrough(turn, fromSeq + run.length, sourceWave);
      if (isCoopDebug()) {
        coopLog("replay", `guest live-pump drain turn=${turn} seq=${fromSeq}..${fromSeq + run.length - 1}`);
      }
    }
    return run;
  }

  /** Key the SHARED per-turn render watermark exactly like the live-event buffer so both replay phases agree. */
  private renderedThroughKey(turn: number, sourceWave?: number): string {
    const current = this.currentAuthorityAddress(turn, sourceWave);
    if (this.authorityContext != null && current != null) {
      return pendingTurnKey(current);
    }
    return `t:${turn}`;
  }

  /**
   * GUEST (#822 double-render): how many event POSITIONS (seq 0..N-1) have already been rendered for `turn`
   * by ANY {@linkcode CoopReplayTurnPhase} instance (0 when none). The turn-end merge starts from the MAX of
   * this and the phase's own `rendered`, so a duplicate replay phase (its own `rendered=0`) re-renders only
   * positions the live-event stream had not already presented.
   */
  renderedThroughForTurn(turn: number, sourceWave?: number): number {
    return this.renderedThrough.get(this.renderedThroughKey(turn, sourceWave)) ?? 0;
  }

  /** GUEST (#822 double-render): monotonically advance the shared per-turn render watermark to `throughCount`. */
  noteRenderedThrough(turn: number, throughCount: number, sourceWave?: number): void {
    if (!Number.isFinite(throughCount) || throughCount <= 0) {
      return;
    }
    const key = this.renderedThroughKey(turn, sourceWave);
    if (throughCount <= (this.renderedThrough.get(key) ?? 0)) {
      return;
    }
    rememberBounded(this.renderedThrough, key, throughCount);
    while (this.renderedThrough.size > LIVE_EVENT_TURN_RETENTION + 1) {
      const oldest = this.renderedThrough.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === key) {
        break;
      }
      this.renderedThrough.delete(oldest);
    }
  }

  /**
   * authority-v2 turn CUTOVER (surface 1): deliver a RELIABLY-transported turn resolution through the
   * EXACT same admission + waiter path the (now-cosmetic, unretained) legacy `turnResolution` carrier
   * uses on receipt. Under cutover the host emits the legacy carrier cosmetically (sent once, never
   * retained/resent), so a lost or raced cosmetic carrier would otherwise starve the guest's parked
   * {@linkcode CoopReplayTurnPhase} pump - the observed soft-lock class (stuck at an ability/presentation
   * phase, never reaching CommandPhase). The v2 authority log delivers the SAME resolution reliably; the
   * replica hands it here as the backstop. Idempotent by the turnResolution admission classification (an
   * identical redelivery is re-ACKed / ignored, never re-applied), so first delivery and every redelivery
   * are equivalent, and racing the cosmetic carrier only settles the same waiter once.
   */
  ingestAuthoritativeV2Turn(
    msg: Extract<CoopMessage, { t: "turnResolution" }>,
    nextControl: CoopNextControl,
    authorityRevision: number,
  ): void {
    // This carrier has already crossed the Authority V2 frame/session/membership/order admission boundary.
    // Retain it independently of the renderer's ambient legacy battle shell: the host may commit while the
    // guest shell has speculatively advanced its local turn but before the exact replay consumer starts.
    // Cosmetic legacy packets still use the ordinary ambient-address rejection below.
    this.handle(msg, "authority-v2", nextControl, authorityRevision);
  }

  /**
   * Deliver a reliably-retained V2 replacement through the existing strict engine transaction. The frame
   * already passed V2 session/membership/order admission, so the ambient legacy battle-shell address may
   * not discard it; immutable carrier classification, complete-companion checks, and apply/checksum proof
   * remain unchanged.
   */
  ingestAuthoritativeV2Replacement(
    msg: Extract<CoopMessage, { t: "battleCheckpoint" }>,
    nextControl: CoopNextControl,
    authorityRevision: number,
    presentation: CoopSwitchPresentation | null,
  ): void {
    this.handle(msg, "authority-v2", nextControl, authorityRevision, presentation);
  }

  /** Whether this exact V2 replacement has already drained its pre-checkpoint visual event. */
  hasRenderedReplacementPresentation(envelope: CoopCheckpointEnvelope): boolean {
    return this.renderedReplacementPresentations.has(this.replacementPresentationKey(envelope));
  }

  /** Exactly-once presentation watermark. Redelivery can re-prove material without replaying the summon. */
  noteRenderedReplacementPresentation(envelope: CoopCheckpointEnvelope): void {
    const key = this.replacementPresentationKey(envelope);
    this.renderedReplacementPresentations.add(key);
    while (this.renderedReplacementPresentations.size > 512) {
      const oldest = this.renderedReplacementPresentations.values().next().value as string | undefined;
      if (oldest === undefined || oldest === key) {
        break;
      }
      this.renderedReplacementPresentations.delete(oldest);
    }
  }

  private replacementPresentationKey(envelope: CoopCheckpointEnvelope): string {
    return `${authorityKey(envelope)}:v2r${envelope.authorityRevision ?? 0}`;
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
    sourceWave?: number,
  ): Promise<
    | { kind: "turn"; res: CoopTurnResolution | null }
    | { kind: "live" }
    | { kind: "checkpoint" }
    | { kind: "superseded" }
  > {
    // Fast paths: anything already buffered resolves without parking waiters. Replacement authority
    // normally follows the turn commit it repairs, but it can also be captured mid-turn and lose the
    // delivery race to a newer final turn. Both carriers share the monotonic authoritative-state tick,
    // so consume the newest revision instead of assuming one carrier class is always newer.
    const waitedAddress = this.currentAuthorityAddress(turn, sourceWave);
    const checkpoint = this.peekCheckpointForTurn(turn, sourceWave);
    const bufferedTurn = this.bufferedTurnEntry(turn, sourceWave)?.[1];
    if (
      checkpoint != null
      && this.checkpointCanWakeTurn(checkpoint, waitedAddress, turn)
      && (bufferedTurn == null || checkpoint.revision > bufferedTurn.revision)
    ) {
      return Promise.resolve({ kind: "checkpoint" as const });
    }
    if (bufferedTurn != null) {
      return this.awaitTurn(turn, sourceWave).then(res => ({ kind: "turn" as const, res }));
    }
    const liveEntry = this.liveTurnEntry(turn, sourceWave);
    if (liveEntry != null && liveEntry[1].events.has(fromSeq)) {
      return Promise.resolve({ kind: "live" as const });
    }
    const waitKey = this.turnWaitAddress(turn, sourceWave).key;
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
        // A turn delivery resolves awaitTurn through a promise reaction. A checkpoint delivered in the
        // following transport microtask can otherwise win before that reaction runs, despite being older.
        // Admission is synchronous, so its immutable ledger is the ordering source of truth here.
        const admittedTurn = this.highestSeenTurnAuthority.get(pendingTurnKey(envelope));
        if (admittedTurn != null && admittedTurn.revision >= envelope.revision) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ kind: "checkpoint" });
      };
      this.liveWaiter = settleLive;
      this.checkpointWaiter = settleCheckpoint;
      void this.awaitTurn(turn, sourceWave).then(res => {
        const superseded = res == null && this.supersededTurnWaits.delete(waitKey);
        if (!settled) {
          settled = true;
          cleanup();
          resolve(superseded ? { kind: "superseded" } : { kind: "turn", res });
          return;
        }
        // The live/checkpoint leg already won this race; a resolution landing on the stale
        // waiter must be REBUFFERED so the pump's next race consumes it (never lost).
        if (res != null) {
          coopLog("replay", `guest live-pump rebuffer turnResolution turn=${turn} (raced out)`);
          rememberBounded(this.inbox, bufferedAuthorityKey("turnResolution", res), res);
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
  abortTurnWait(turn: number, sourceWave?: number): boolean {
    const lookup = this.turnWaitAddress(turn, sourceWave);
    const pending = this.pending.get(lookup.key);
    if (pending == null) {
      return false;
    }
    coopWarn("replay", `guest awaitTurn turn=${turn} ABORT (phantom turn dissolve #859)`);
    pending.finish(null);
    return true;
  }

  awaitTurn(turn: number, sourceWave?: number): Promise<CoopTurnResolution | null> {
    if (this.authorityTerminalStarted || this.disposed) {
      return Promise.resolve(null);
    }
    const lookup = this.turnWaitAddress(turn, sourceWave);
    // Supersede every stale waiter for this numeric turn. Addressed keys prevent it from resolving the
    // new waiter, while actively dissolving it avoids a prior wave's 20-minute timeout firing later.
    for (const [key, stale] of [...this.pending.entries()]) {
      if (key !== lookup.key && stale.turn === turn) {
        coopWarn("stream", `guest awaitTurn turn=${turn} superseding stale addressed waiter key=${key}`);
        rememberBoundedValue(this.supersededTurnWaits, key);
        stale.finish(null);
        // `awaitTurnOrLiveEvent` consumes this marker in the already-registered
        // promise reaction. Clear it one microtask later as well so a direct
        // awaitTurn caller cannot leave evidence that a future, unrelated wait
        // at the reused address could mistake for its own supersession.
        queueMicrotask(() => this.supersededTurnWaits.delete(key));
        if (stale.address != null) {
          this.clearTurnCommitRequestsAtAddress(stale.address);
        }
      }
    }
    const duplicate = this.pending.get(lookup.key);
    if (duplicate != null) {
      // Same-address consumers are one logical authority wait. Cancelling the first waiter made its
      // replay phase interpret an internal duplicate pump as missing host authority and terminalize a
      // healthy session before the delayed host commit arrived. Join the in-flight result instead.
      coopLog("stream", `guest awaitTurn turn=${turn} JOIN duplicate addressed waiter`);
      if (lookup.address != null && this.authorityContext != null) {
        this.requestTurnCommit(lookup.address.epoch, lookup.address.wave, lookup.address.turn);
      }
      return duplicate.promise;
    }
    if (lookup.address != null && this.authorityContext != null) {
      this.requestTurnCommit(lookup.address.epoch, lookup.address.wave, lookup.address.turn);
    }
    const bufferedEntry = this.bufferedTurnEntry(turn, sourceWave);
    if (bufferedEntry !== undefined) {
      const [, buffered] = bufferedEntry;
      discardAuthorityThrough(this.inbox, buffered);
      if (this.authorityContext != null) {
        this.requestTurnCommit(buffered.epoch, buffered.wave, buffered.turn, buffered.revision);
      }
      coopLog("replay", `guest awaitTurn turn=${turn} RESOLVE (buffered race) events=${buffered.events.length}`);
      return Promise.resolve(buffered);
    }
    coopLog("replay", `guest awaitTurn turn=${turn} START timeout=${this.timeoutMs}ms`);
    this.pendingSince.set(lookup.key, Date.now());
    let resolvePromise!: (res: CoopTurnResolution | null) => void;
    const promise = new Promise<CoopTurnResolution | null>(resolve => {
      resolvePromise = resolve;
    });
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
        coopLog("replay", `guest awaitTurn turn=${turn} RESOLVE events=${res.events.length} checksum=${res.checksum}`);
      }
      resolvePromise(res);
    };
    this.pending.set(lookup.key, { turn, address: lookup.address, promise, finish });
    cancelTimer = this.schedule(() => finish(null), this.timeoutMs);
    return promise;
  }

  /** GUEST: request one exact authenticated recovery frontier. */
  requestStateSync(reason: Exclude<CoopRecoveryReason, "durability-gap">): Promise<CoopStateSyncOutcome> {
    // Supersede every older in-flight resync (the newest desync is the one to heal).
    const inFlight = this.stateSyncWaiters.size;
    if (inFlight > 0) {
      coopWarn("resync", `guest requestStateSync reason=${reason} superseding ${inFlight} older request(s)`);
    }
    for (const waiter of [...this.stateSyncWaiters.values()]) {
      waiter.finish({ kind: "superseded" });
    }
    for (const finish of [...this.launchSnapshotWaiters.values()]) {
      finish(null);
    }
    this.stateSyncWaiters.clear();
    this.launchSnapshotWaiters.clear();
    const seq = ++this.stateSyncSeq;
    const ticket = this.mintRecoveryTicket(reason, seq);
    if (ticket == null) {
      coopWarn("resync", `guest requestStateSync reason=${reason} seq=${seq} refused without exact binding/frontier`);
      return Promise.resolve({ kind: "unavailable" });
    }
    const key = recoveryTicketKey(ticket);
    coopLog(
      "resync",
      `guest requestStateSync id=${ticket.requestId} reason=${reason} e=${ticket.frontier.epoch} `
        + `wave=${ticket.frontier.wave} turn=${ticket.frontier.turn} START timeout=${this.recoveryTimeoutMs}ms`,
    );
    return new Promise<CoopStateSyncOutcome>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (outcome: CoopStateSyncOutcome) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.stateSyncWaiters.get(key)?.finish === finish) {
          this.stateSyncWaiters.delete(key);
        }
        if (outcome.kind === "snapshot") {
          coopLog("resync", `guest requestStateSync id=${ticket.requestId} RESOLVE blobLen=${outcome.blob.length}`);
        } else {
          coopWarn("resync", `guest requestStateSync id=${ticket.requestId} -> ${outcome.kind}`);
        }
        resolve(outcome);
      };
      this.stateSyncWaiters.set(key, { ticket, finish });
      cancelTimer = this.schedule(() => finish({ kind: "timeout" }), this.recoveryTimeoutMs);
      this.transport.send({ t: "requestStateSync", ticket });
    });
  }

  // --- shared -----------------------------------------------------------------

  /**
   * Cancel old waits and drop every race buffer/retained carrier when this streamer
   * is deliberately carried across a launch/resume session boundary.
   *
   * Turn and replacement commits are fully epoch-addressed, but encounter, launch,
   * ME-battle, and ghost-pool carriers predate that address and are keyed only by a
   * wave or interaction key. Leaving one of those frames alive lets a new session
   * reuse the key and adopt the previous session's data before its real host frame
   * arrives. Old waiters must be failed too: otherwise a new session's genuine
   * wave-only carrier can resolve an abandoned phase and be stolen from the new one.
   * Transport listeners and runtime-level handlers stay installed; this is a session
   * reset on the same connected runtime, not dispose.
   */
  purgeSessionBoundaryState(reason: string): void {
    const buffered =
      this.inbox.size
      + this.liveEvents.size
      + this.pendingCheckpoints.size
      + this.appliedOutOfBandCheckpoints.size
      + this.meBattlePartyInbox.size
      + this.entryPresentationByWave.size
      + this.enemyPartyStateByWave.size
      + this.enemyPartyEncounterByWave.size
      + this.enemyPartyAuthorityFloorByWave.size
      + this.meTypeByWave.size
      + this.battleTypeByWave.size
      + Number(this.lastEnemyParty != null)
      + Number(this.lastLaunchSnapshot != null)
      + Number(this.lastGhostPool != null);
    if (buffered > 0) {
      coopWarn(
        "stream",
        `purgeSessionBoundaryState(${reason}) dropping ${buffered} battle-stream arrival(s) (stale-session isolation)`,
      );
    } else {
      coopLog("stream", `purgeSessionBoundaryState(${reason}) nothing buffered`);
    }

    this.cancelRetainedAuthorityTimers();
    this.cancelAuthorityGameplayWaiters();
    this.clearRetainedAuthorityAfterTerminal();
    this.meBattlePartyInbox.clear();
    this.supersededTurnWaits.clear();
    this.finalizedMarks.clear();
    this.finalizedTurnAuthorities.clear();
    this.finalizedReplacementAuthorities.clear();
    this.lastEnemyParty = null;
    this.entryPresentationByWave.clear();
    this.consumedEntryPresentationThroughWave = 0;
    this.enemyPartyStateByWave.clear();
    this.enemyPartyEncounterByWave.clear();
    this.enemyPartyAuthorityFloorByWave.clear();
    this.meTypeByWave.clear();
    this.battleTypeByWave.clear();
    this.lastLaunchSnapshot = null;
    this.launchSnapshotAbortWaves.clear();
    this.consumedLaunchSnapshotWaves.clear();
    this.lastGhostPool = null;

    // These are host-side replay sources with the same wave-only identities. A
    // request in the new session must never be answered from the previous one.
    this.sentMeBattleParties.clear();
    this.sentEnemyParties.clear();
    this.lastSentLaunchSnapshot = null;
    this.lastSentLaunchSnapshotAbort = null;
    this.lastAuthorityFailure = null;
    this.ackedAuthorityFailures.clear();
    this.authorityFailureRevision = 0;
    this.meMessageHandler = null;
  }

  /** Stop listening and fail any in-flight awaits. */
  dispose(): void {
    this.disposed = true;
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
    for (const finish of [...this.entryPresentationWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.meBattlePartyWaiters.values()]) {
      finish(null);
    }
    for (const finish of [...this.launchSnapshotWaiters.values()]) {
      finish(null);
    }
    for (const waiter of [...this.stateSyncWaiters.values()]) {
      waiter.finish({ kind: "superseded" });
    }
    this.pending.clear();
    this.pendingSince.clear();
    for (const cancel of this.turnRequestTimers.values()) {
      cancel();
    }
    this.turnRequestTimers.clear();
    this.requestedTurnCommits.clear();
    this.turnRedeliveryRequests.clear();
    for (const cancel of this.sentTurnCommitTimers.values()) {
      cancel();
    }
    this.sentTurnCommitTimers.clear();
    this.sentTurnCommits.clear();
    this.issuedTurnAuthority.clear();
    this.sentTurnCommitDeadlines.clear();
    this.turnCommitHandlers.clear();
    this.ackedTurnCommits.clear();
    this.hostTurnAckEvidence.clear();
    this.pendingTurnContinuations.clear();
    this.admittedWaveAdvanceContinuations.clear();
    this.highestSeenTurnAuthority.clear();
    this.seenTurnAuthority.clear();
    this.enemyPartyWaiters.clear();
    this.entryPresentationWaiters.clear();
    this.meBattlePartyWaiters.clear();
    this.launchSnapshotWaiters.clear();
    this.meBattlePartyInbox.clear();
    this.sentMeBattleParties.clear();
    this.stateSyncWaiters.clear();
    this.inbox.clear();
    this.liveEvents.clear();
    this.renderedThrough.clear();
    this.renderedReplacementPresentations.clear();
    this.supersededTurnWaits.clear();
    this.finalizedMarks.clear();
    this.finalizedTurnAuthorities.clear();
    this.finalizedReplacementAuthorities.clear();
    this.liveEventHandler = null;
    this.liveWaiter = null;
    this.pendingCheckpoints.clear();
    this.replacementRedeliveryRequests.clear();
    this.highestSeenReplacementAuthority.clear();
    this.seenReplacementAuthority.clear();
    for (const cancel of this.sentReplacementTimers.values()) {
      cancel();
    }
    this.sentReplacementTimers.clear();
    this.sentReplacementCheckpoints.clear();
    this.issuedReplacementAuthority.clear();
    this.sentReplacementDeadlines.clear();
    this.ackedReplacementCommits.clear();
    this.hostReplacementAckEvidence.clear();
    this.pendingReplacementContinuations.clear();
    this.hostAppliedReplacementAcks.clear();
    this.causallyRetiredReplacementAuthority.clear();
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
    this.entryPresentationByWave.clear();
    this.consumedEntryPresentationThroughWave = 0;
    this.sentEnemyParties.clear();
    this.enemyPartyStateByWave.clear();
    this.enemyPartyEncounterByWave.clear();
    this.enemyPartyAuthorityFloorByWave.clear();
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

  private handle(
    msg: CoopMessage,
    source: "transport" | "authority-v2" = "transport",
    authorityNextControl?: CoopNextControl,
    authorityRevision?: number,
    replacementPresentation: CoopSwitchPresentation | null = null,
  ): void {
    switch (msg.t) {
      case "enemyPartySync": {
        const entryPresentation = msg.entryPresentation;
        if (
          entryPresentation !== undefined
          && (!isStrictEntryPresentation(entryPresentation)
            || msg.authoritativeState == null
            || msg.authoritativeState.wave !== msg.wave
            || !isSafeAddressPart(msg.authoritativeState.tick))
        ) {
          coopWarn("stream", `guest rejected malformed entry presentation wave=${msg.wave}`);
          return;
        }
        const floor = this.enemyPartyAuthorityFloorByWave.get(msg.wave);
        if (floor != null && (msg.authoritativeState === undefined || msg.authoritativeState.tick <= floor)) {
          coopLog(
            "stream",
            `guest ignored retired enemyParty carrier wave=${msg.wave} tick=${msg.authoritativeState?.tick ?? "-"} floor=${floor}`,
          );
          return;
        }
        if (msg.authoritativeState !== undefined) {
          if (msg.authoritativeState.wave === msg.wave) {
            const prior = this.enemyPartyStateByWave.get(msg.wave);
            if (prior == null || msg.authoritativeState.tick > prior.tick) {
              this.enemyPartyStateByWave.set(msg.wave, msg.authoritativeState);
            } else if (msg.authoritativeState.tick < prior.tick) {
              coopLog(
                "stream",
                `guest ignored regressed enemyParty state wave=${msg.wave} tick=${msg.authoritativeState.tick} retained=${prior.tick}`,
              );
              return;
            } else if (canonicalize(prior) !== canonicalize(msg.authoritativeState)) {
              const current = this.currentAuthorityAddress(msg.authoritativeState.turn);
              const reason = `Enemy-party authority changed at immutable wave/tick ${msg.wave}/${prior.tick}.`;
              if (current == null) {
                coopWarn("stream", `${reason} No authenticated runtime address remained for the shared terminal.`);
              } else {
                this.failLocalAckProgression(
                  "replacement",
                  {
                    epoch: current.epoch,
                    wave: msg.wave,
                    turn: msg.authoritativeState.turn,
                    revision: Math.max(1, msg.authoritativeState.tick),
                  },
                  reason,
                );
              }
              return;
            }
          } else {
            // Fail closed on the mis-addressed STATE only (it is never stored/peekable). The party-list
            // carrier itself still resolves a parked awaitEnemyParty below - returning here left the
            // guest's wave build parked forever behind one corrupt state field (lane A stream:319).
            coopWarn(
              "stream",
              `guest rejected enemyParty state address carrierWave=${msg.wave} stateWave=${msg.authoritativeState.wave}`,
            );
          }
          while (this.enemyPartyStateByWave.size > 4) {
            const oldestWave = Math.min(...this.enemyPartyStateByWave.keys());
            this.enemyPartyStateByWave.delete(oldestWave);
          }
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
        // Admit presentation only after the carrier's floor/address/tick checks above. A retired or
        // regressed wave-start state must never reintroduce obsolete cosmetics into a newer frontier.
        if (entryPresentation !== undefined) {
          const presentationState = msg.authoritativeState;
          if (presentationState == null) {
            // The strict carrier check above already rejects this branch; keep the local proof explicit so
            // later refactors cannot accidentally detach the prefix from its state image.
            return;
          }
          if (msg.wave <= this.consumedEntryPresentationThroughWave) {
            coopLog("replay", `guest IGNORE duplicate consumed entry presentation wave=${msg.wave}`);
          } else {
            const immutableEntryPresentation: CoopEntryPresentationPrefix = {
              events: structuredClone(entryPresentation),
              stateTick: presentationState.tick,
            };
            const prior = this.entryPresentationByWave.get(msg.wave);
            if (prior != null && canonicalize(prior.events) !== canonicalize(entryPresentation)) {
              coopWarn("stream", `guest rejected conflicting entry presentation wave=${msg.wave}`);
              return;
            }
            const entryWaiter = this.entryPresentationWaiters.get(msg.wave);
            if (entryWaiter == null) {
              this.entryPresentationByWave.set(msg.wave, immutableEntryPresentation);
            } else {
              entryWaiter(immutableEntryPresentation);
            }
            while (this.entryPresentationByWave.size > 4) {
              const oldestWave = Math.min(...this.entryPresentationByWave.keys());
              this.entryPresentationByWave.delete(oldestWave);
            }
            coopLog(
              "replay",
              `guest RECV entry presentation wave=${msg.wave} stateTick=${immutableEntryPresentation.stateTick} `
                + `events=${entryPresentation.length} `
                + `${entryWaiter == null ? "buffered" : "delivered"}`,
            );
          }
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
        this.lastEnemyParty = {
          wave: msg.wave,
          enemies: msg.enemies,
          ...(msg.authoritativeState === undefined ? {} : { stateTick: msg.authoritativeState.tick }),
        };
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
        if (this.authorityTerminalStarted) {
          return;
        }
        const invalidEventIndex = Array.isArray(msg.events)
          ? msg.events.findIndex(event => !isStrictBattleEvent(event))
          : -1;
        const structurallyComplete =
          typeof msg.preimage === "string"
          && msg.preimage.length > 0
          && Array.isArray(msg.events)
          && invalidEventIndex < 0
          && hasCompleteAuthorityCompanions(msg);
        if (!structurallyComplete) {
          coopWarn(
            "replay",
            `guest DROP malformed turnResolution turn=${msg.turn} preimage=${typeof msg.preimage === "string"} `
              + `fullField=${Array.isArray(msg.fullField) ? msg.fullField.length : 0} `
              + `state=${msg.authoritativeState == null ? 0 : 1} checksum=${msg.checksum} `
              + `invalidEvent=${invalidEventIndex}`,
          );
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
        if (source === "transport" && suppressesLegacyTurnApplication(activeCoopTurnAuthorityMode())) {
          // The retained V2 TURN_COMMIT reconstructs this exact complete image together with its global
          // revision and typed nextControl. The raw copy is deliberately unretained telemetry. Admitting it
          // here used to let it win the inbox/waiter race; the later V2 copy then classified as an identical
          // duplicate and could not attach its successor, so faint turns fell through into a phantom command.
          coopLog(
            "stream",
            `guest IGNORE cosmetic turnResolution e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        const exactKey = authorityKey(res);
        const completedAck = this.ackedTurnCommits.get(exactKey);
        const admitted = this.seenTurnAuthority.get(exactKey);
        if (
          completedAck?.stage === "continuationReady"
          && admitted != null
          && admitted.canonical === canonicalize(res)
        ) {
          // The final ACK may be lost immediately before the guest crosses into the next wave/turn.
          // Host retention then redelivers the old immutable carrier after the address has advanced.
          // Re-ACK the exact completed identity before the live-address gate; never re-admit or re-apply it.
          coopLog(
            "replay",
            `guest RE-ACK completed cross-address turn commit e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          this.transport.send(completedAck.value);
          return;
        }
        if (source !== "authority-v2" && !this.acceptsAwaitedTurnAddress(res)) {
          // Retained commits may be redelivered after the guest has already crossed the corresponding
          // boundary. They are valid carriers, but they must not be admitted under a different awaited
          // address. Keep this distinct from schema validation: `state=1` in the malformed diagnostic only
          // meant that authoritativeState existed and repeatedly obscured this stale-delivery condition.
          coopWarn(
            "stream",
            `guest DROP unawaited turnResolution e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        const admission = this.classifyAuthority(this.highestSeenTurnAuthority, this.seenTurnAuthority, res);
        if (admission.kind === "conflict") {
          this.beginAuthorityTerminal({
            epoch: msg.epoch,
            wave: msg.wave,
            turn: msg.turn,
            revision: msg.revision,
            boundary: "turnResolution",
            reason: `Conflicting turn authority arrived for immutable revision ${authorityKey(msg)}.`,
            failureId: `conflict:turnResolution:${authorityKey(msg)}`,
          });
          return;
        }
        if (admission.kind === "older") {
          this.turnRedeliveryRequests.delete(authorityKey(msg));
          this.clearTurnCommitRequest(turnCommitRequestKey(msg));
          coopWarn(
            "stream",
            `guest DROP older turn revision e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        if (admission.kind === "identical") {
          const exactKey = authorityKey(msg);
          const evidence = this.ackedTurnCommits.get(exactKey);
          if (evidence != null) {
            coopLog(
              "replay",
              `guest RE-ACK immutable turn commit e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
            );
            this.transport.send(evidence.value);
            return;
          }
          if (this.turnRedeliveryRequests.delete(exactKey)) {
            coopLog(
              "replay",
              `guest REDELIVER explicitly retried turn commit e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
            );
            for (const handler of [...this.turnCommitHandlers]) {
              try {
                handler(copyAdmittedAuthority(admission.seen));
              } catch (error) {
                coopWarn("stream", `turn retry observer threw turn=${msg.turn} (isolated)`, error);
              }
            }
            return;
          }
          coopLog(
            "stream",
            `guest IGNORE idempotent turn duplicate e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        this.clearSupersededTurnCommitRequests(msg);
        const address: CoopTurnAddress = { epoch: msg.epoch, wave: msg.wave, turn: msg.turn };
        const waitKey = pendingTurnKey(address);
        const bufferKey = bufferedAuthorityKey("turnResolution", res);
        const exactPending = this.pending.get(waitKey);
        const legacyPending = this.authorityContext == null ? this.pending.get(legacyTurnKey(msg.turn)) : undefined;
        const resolver = exactPending ?? legacyPending;
        // Keep V2 control metadata out of the legacy material canonicalization above: the cosmetic
        // turnResolution carries the same material without this local-only projection, and racing it must
        // classify as an identical carrier rather than conflicting with the authoritative V2 entry. The
        // renderer still receives the exact host-stated successor on the V2 admission path.
        const deliveredResolution: CoopTurnResolution =
          source === "authority-v2" && authorityNextControl !== undefined && authorityRevision !== undefined
            ? { ...res, authorityNextControl, authorityRevision }
            : res;
        coopLog(
          "replay",
          `guest RECV turnResolution e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} events=${msg.events.length} `
            + `checksum=${msg.checksum} ${resolver ? "-> parked waiter" : "-> buffered (no waiter)"}`,
        );
        if (resolver) {
          resolver.finish(deliveredResolution);
        } else {
          // No waiter yet: retain this exact immutable revision. A later revision at the same turn gets
          // its own slot; handoff chooses the newest and atomically prunes its superseded predecessors.
          rememberBounded(this.inbox, bufferKey, deliveredResolution);
        }
        for (const handler of [...this.turnCommitHandlers]) {
          try {
            handler(deliveredResolution);
          } catch (error) {
            coopWarn("stream", `turn commit observer threw turn=${res.turn} (isolated)`, error);
          }
        }
        return;
      }
      case "battleEvent": {
        if (this.authorityTerminalStarted) {
          return;
        }
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
        if (this.authorityTerminalStarted) {
          return;
        }
        if (!hasCompleteAuthorityCompanions(msg)) {
          coopWarn(
            "checkpoint",
            `guest DROP malformed battleCheckpoint reason=${msg.reason} `
              + `fullField=${Array.isArray(msg.fullField) ? msg.fullField.length : 0} `
              + `state=${msg.authoritativeState == null ? 0 : 1} checksum=${msg.checksum}`,
          );
          return;
        }
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
        const exactKey = authorityKey(envelope);
        const completedAck = this.ackedReplacementCommits.get(exactKey);
        const admitted = this.seenReplacementAuthority.get(exactKey);
        if (
          completedAck?.stage === "continuationReady"
          && admitted != null
          && admitted.canonical === canonicalize(envelope)
        ) {
          coopLog(
            "checkpoint",
            `guest RE-ACK completed cross-address replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          this.transport.send(completedAck.value);
          return;
        }
        if (source !== "authority-v2" && !this.acceptsCheckpointAddress(envelope)) {
          coopWarn(
            "checkpoint",
            `guest DROP cross-address battleCheckpoint reason=${msg.reason} e=${msg.epoch} wave=${msg.wave} `
              + `turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        const admission = this.classifyAuthority(
          this.highestSeenReplacementAuthority,
          this.seenReplacementAuthority,
          envelope,
        );
        if (admission.kind === "conflict") {
          this.beginAuthorityTerminal({
            epoch: msg.epoch,
            wave: msg.wave,
            turn: msg.turn,
            revision: msg.revision,
            boundary: "replacement",
            reason: `Conflicting replacement authority arrived for immutable revision ${authorityKey(msg)}.`,
            failureId: `conflict:replacement:${authorityKey(msg)}`,
          });
          return;
        }
        if (admission.kind === "older") {
          this.replacementRedeliveryRequests.delete(authorityKey(msg));
          coopWarn(
            "checkpoint",
            `guest DROP older replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        if (admission.kind === "identical") {
          const exactKey = authorityKey(msg);
          const evidence = this.ackedReplacementCommits.get(exactKey);
          if (evidence != null) {
            coopLog(
              "checkpoint",
              `guest RE-ACK immutable replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
            );
            this.transport.send(evidence.value);
            return;
          }
          if (this.replacementRedeliveryRequests.delete(exactKey)) {
            const retained = copyAdmittedAuthority(admission.seen);
            const delivered =
              source === "authority-v2" && authorityNextControl !== undefined && authorityRevision !== undefined
                ? { ...retained, authorityNextControl, authorityRevision, replacementPresentation }
                : retained;
            coopLog(
              "checkpoint",
              `guest REDELIVER explicitly retried replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
            );
            // Re-open the same safe-boundary consumer as a first delivery. Observers wake the replay
            // pump, but consumeCheckpoint() is the transaction handoff; omitting this buffer made a
            // requested retry observable yet impossible to apply.
            const key = bufferedAuthorityKey("replacement", retained);
            rememberBounded(this.pendingCheckpoints, key, structuredClone(delivered));
            this.notifyCheckpointEnvelope(delivered);
            this.checkpointWaiter?.(delivered);
            this.checkpointHandler?.(delivered.reason, delivered.checkpoint);
            return;
          }
          coopLog(
            "checkpoint",
            `guest IGNORE idempotent replacement e=${msg.epoch} wave=${msg.wave} turn=${msg.turn} rev=${msg.revision}`,
          );
          return;
        }
        const key = bufferedAuthorityKey("replacement", envelope);
        const deliveredEnvelope =
          source === "authority-v2" && authorityNextControl !== undefined && authorityRevision !== undefined
            ? { ...envelope, authorityNextControl, authorityRevision, replacementPresentation }
            : envelope;
        // Buffer for the guest's next consumeCheckpoint() (applied at a turn boundary),
        // carrying the host's checksum so the guest can verify convergence after applying.
        coopLog("checksum", `guest RECV battleCheckpoint reason=${msg.reason} checksum=${msg.checksum}`);
        rememberBounded(this.pendingCheckpoints, key, deliveredEnvelope);
        this.notifyCheckpointEnvelope(deliveredEnvelope);
        this.checkpointWaiter?.(deliveredEnvelope);
        this.checkpointHandler?.(msg.reason, msg.checkpoint);
        return;
      }
      case "requestTurnCommit": {
        if (this.authorityTerminalStarted) {
          return;
        }
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
        if (this.authorityTerminalStarted) {
          return;
        }
        const key = authorityKey(msg);
        const retained = this.sentTurnCommits.get(key);
        const prior = this.hostTurnAckEvidence.get(key);
        const stage = msg.stage;
        const supersedingAck =
          msg.status === "superseded"
            ? [...this.hostReplacementAckEvidence.values()].find(
                // Replacement authority is normally captured after TurnEnd opens N+1, so its exact
                // staged ACK may prove a delayed N commit superseded. Same-turn recovery is also valid;
                // anything beyond the immediate successor is unrelated and cannot clear it.
                evidence =>
                  evidence.value.epoch === msg.epoch
                  && evidence.value.wave === msg.wave
                  && (evidence.value.turn === msg.turn || evidence.value.turn === msg.turn + 1)
                  && evidence.value.revision === msg.supersededByRevision
                  && evidence.value.checksum === msg.supersededByChecksum
                  && evidence.value.revision > msg.revision
                  && isAuthorityAckStage(stage)
                  && AUTHORITY_ACK_STAGE_ORDER[evidence.stage] >= AUTHORITY_ACK_STAGE_ORDER[stage],
              )
            : undefined;
        if (
          retained == null
          || !isAuthorityAckStage(stage)
          || retained.checkpoint.tick !== msg.checkpointTick
          || retained.authoritativeState.tick !== msg.stateTick
          || retained.checksum !== msg.checksum
          || (msg.status !== "applied" && msg.status !== "superseded")
          || (msg.status === "superseded" && supersedingAck == null)
        ) {
          // A fully committed exact duplicate is harmless; every other missing/wrong-address ACK is a
          // protocol violation while shared play is live and must converge through the bounded terminal.
          if (
            retained == null
            && prior?.stage === "continuationReady"
            && isAuthorityAckStage(stage)
            && prior.canonical === canonicalize(msg)
          ) {
            return;
          }
          // authority-v2 turn CUTOVER: the host emitted the carrier COSMETICALLY (retainAndRetryTurnCommit
          // cosmeticOnly => sentTurnCommits is never populated for a cut-over turn), so a staged compatibility
          // ACK arriving with retained==null is EXPECTED, not a violation. It comes from rendering the complete
          // carrier reconstructed by ingestAuthoritativeV2Turn; the V2 controlInstalled receipt is the SOLE
          // retirement. The raw transport copy is never mechanically admitted under cutover.
          if (retained == null && suppressesLegacyTurnAckProgression(activeCoopTurnAuthorityMode())) {
            coopLog("stream", `host IGNORE cosmetic turn ACK stage=${stage} key=${key} (v2 owns retirement)`);
            return;
          }
          this.failHostAckProgression("turnResolution", msg, `Turn ACK was missing/stale/wrong-address at ${key}.`);
          return;
        }
        const canonical = canonicalize(msg);
        if (
          prior != null
          && (prior.value.status !== msg.status
            || prior.value.supersededByRevision !== msg.supersededByRevision
            || prior.value.supersededByChecksum !== msg.supersededByChecksum)
        ) {
          this.failHostAckProgression(
            "turnResolution",
            msg,
            `Turn ACK supersession evidence changed between stages at ${key}.`,
          );
          return;
        }
        const progress = classifyAckProgress(prior, stage, canonical);
        if (progress === "invalid") {
          this.failHostAckProgression(
            "turnResolution",
            msg,
            `Turn ACK stage ${String(stage)} skipped/regressed/conflicted at ${key} (prior=${prior?.stage ?? "none"}).`,
          );
          return;
        }
        if (progress === "advance") {
          rememberAckEvidence(this.hostTurnAckEvidence, key, { stage, canonical, value: msg });
        }
        coopLog("stream", `host ACCEPT turn ACK stage=${stage} key=${key}`);
        if (stage !== "continuationReady") {
          // materialApplied/presentationReady may suppress duplicate work, but never release authority.
          return;
        }
        if (msg.status === "applied") {
          this.releaseCausallyDominatedReplacements(retained, "turnResolution");
        }
        this.sentTurnCommits.delete(key);
        this.sentTurnCommitDeadlines.delete(key);
        this.sentTurnCommitTimers.get(key)?.();
        this.sentTurnCommitTimers.delete(key);
        coopLog("stream", `host RELEASE retained turn after continuationReady key=${key}`);
        return;
      }
      case "requestBattleCheckpoint": {
        if (this.authorityTerminalStarted) {
          return;
        }
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
        if (this.authorityTerminalStarted) {
          return;
        }
        const key = authorityKey(msg);
        const retained = this.sentReplacementCheckpoints.get(key);
        const causallyRetired = this.causallyRetiredReplacementAuthority.get(key);
        const prior = this.hostReplacementAckEvidence.get(key);
        const stage = msg.stage;
        if (
          retained == null
          && causallyRetired != null
          && isAuthorityAckStage(stage)
          && msg.reason === "replacement"
          && sameAuthorityAddress(msg, causallyRetired)
          && msg.checkpointTick === causallyRetired.checkpointTick
          && msg.stateTick === causallyRetired.stateTick
          && msg.checksum === causallyRetired.checksum
        ) {
          coopLog("stream", `host IGNORE late ACK for causally retired replacement stage=${stage} key=${key}`);
          return;
        }
        if (
          retained == null
          || !isAuthorityAckStage(stage)
          || msg.reason !== "replacement"
          || !sameAuthorityAddress(msg, retained)
          || msg.checkpointTick !== retained.checkpoint.tick
          || msg.stateTick !== retained.authoritativeState.tick
          || msg.checksum !== retained.checksum
        ) {
          if (
            retained == null
            && prior?.stage === "continuationReady"
            && isAuthorityAckStage(stage)
            && prior.canonical === canonicalize(msg)
          ) {
            return;
          }
          // The live V2 replica deliberately reuses the proven replacement apply/presentation transaction,
          // whose staged compatibility ACKs still cross the legacy transport. No legacy carrier is retained
          // in cutover mode, so those ACKs are observability only; the V2 material/control receipt is the sole
          // retirement authority. A clean V2 ACK must never terminalize because sentReplacementCheckpoints is
          // intentionally empty. A genuine V2 commit failure never reaches this branch: the host terminalizes
          // before allowing a second authority.
          if (retained == null && suppressesLegacyReplacementAckProgression(activeCoopReplacementAuthorityMode())) {
            coopLog(
              "stream",
              `host IGNORE compatibility replacement ACK stage=${stage} key=${key} (v2 owns retirement)`,
            );
            return;
          }
          this.failHostAckProgression("replacement", msg, `Replacement ACK was missing/stale/wrong-address at ${key}.`);
          return;
        }
        const canonical = canonicalize(msg);
        const progress = classifyAckProgress(prior, stage, canonical);
        if (progress === "invalid") {
          this.failHostAckProgression(
            "replacement",
            msg,
            `Replacement ACK stage ${String(stage)} skipped/regressed/conflicted at ${key} (prior=${prior?.stage ?? "none"}).`,
          );
          return;
        }
        if (progress === "advance") {
          rememberAckEvidence(this.hostReplacementAckEvidence, key, { stage, canonical, value: msg });
        }
        coopLog("stream", `host ACCEPT replacement ACK stage=${stage} key=${key}`);
        if (stage !== "continuationReady") {
          return;
        }
        rememberBounded(this.hostAppliedReplacementAcks, key, msg);
        this.sentReplacementCheckpoints.delete(key);
        this.sentReplacementDeadlines.delete(key);
        this.sentReplacementTimers.get(key)?.();
        this.sentReplacementTimers.delete(key);
        this.releaseCausallyDominatedReplacements(retained, "replacement");
        coopLog("stream", `host RELEASE retained replacement after continuationReady key=${key}`);
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
          || !this.acceptsAuthorityFailureAddress(msg)
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
        this.receiveAuthorityTerminal(msg, ack);
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
      case "requestStateSync": {
        const ticket = msg.ticket;
        if (!validRecoveryTicket(ticket)) {
          coopWarn("resync", "host DROP malformed requestStateSync ticket");
          return;
        }
        if (!this.peerRecoveryBindingIsCurrent(ticket.binding)) {
          coopWarn("resync", `host REFUSE requestStateSync id=${ticket.requestId} with stale peer binding`);
          this.sendStateSyncUnavailable(ticket, "superseded");
          return;
        }
        coopLog("resync", `host RECV requestStateSync id=${ticket.requestId} reason=${ticket.reason}`);
        if (!this.peerRecoveryTicketIsCurrent(ticket)) {
          this.sendStateSyncUnavailable(ticket, "superseded");
          return;
        }
        if (this.stateSyncRequestHandler == null) {
          coopWarn("resync", `host RECV requestStateSync id=${ticket.requestId} unavailable (no handler)`);
          this.sendStateSyncUnavailable(ticket, "unavailable");
          return;
        }
        this.stateSyncRequestHandler(ticket);
        return;
      }
      case "stateSync": {
        if (!validRecoveryTicket(msg.ticket)) {
          return;
        }
        const key = recoveryTicketKey(msg.ticket);
        const waiter = this.stateSyncWaiters.get(key);
        if (waiter == null) {
          coopWarn("resync", `guest DROP unbound stateSync id=${msg.ticket.requestId}`);
          return;
        }
        const admission = { ticket: msg.ticket, captured: msg.captured } satisfies CoopRecoveryAdmissionV1;
        if (!this.recoveryAdmissionIsCurrent(admission)) {
          coopWarn("resync", `guest DROP stale/mismatched stateSync id=${msg.ticket.requestId}`);
          waiter.finish({ kind: "superseded" });
          return;
        }
        waiter.finish({ kind: "snapshot", blob: msg.blob, admission });
        return;
      }
      case "stateSyncUnavailable": {
        if (!validRecoveryTicket(msg.ticket)) {
          return;
        }
        const waiter = this.stateSyncWaiters.get(recoveryTicketKey(msg.ticket));
        if (waiter != null) {
          coopWarn("resync", `guest stateSync id=${msg.ticket.requestId} ${msg.reason}`);
          waiter.finish({ kind: msg.reason });
        }
        return;
      }
      case "durabilityStateSync": {
        const admission = { ticket: msg.ticket, captured: msg.captured } satisfies CoopRecoveryAdmissionV1;
        if (msg.ticket.reason !== "durability-gap" || !this.recoveryAdmissionIsCurrent(admission)) {
          coopWarn("resync", "guest DROP stale/mismatched durabilityStateSync");
          return;
        }
        coopLog("resync", `guest RECV durabilityStateSync id=${msg.ticket.requestId} blobLen=${msg.blob.length}`);
        if (this.durabilitySnapshotHandler == null) {
          const reason = `Durability recovery ${msg.ticket.requestId} had no installed snapshot receiver.`;
          coopWarn("resync", reason);
          this.onRecoveryTerminal?.(reason);
          return;
        }
        try {
          this.durabilitySnapshotHandler({ kind: "snapshot", blob: msg.blob, admission });
        } catch (error) {
          const reason = `Durability recovery ${msg.ticket.requestId} snapshot receiver threw.`;
          coopWarn("resync", reason, error);
          this.onRecoveryTerminal?.(reason);
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

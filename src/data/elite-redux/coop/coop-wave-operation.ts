/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op POST-BATTLE WAVE-ADVANCE operation surface - THE KEYSTONE (Wave-2f authoritative
// run-state migration; see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md,
// §2.5 item 4 + §8.6). The FOURTH production wiring of the authoritative operation model
// (coop-operation-runtime.ts), and the one that makes `logicalPhase` HOST-AUTHORITATIVE for
// the between-wave transition - unlocking §3's renderer allowlist strict-tails mode.
//
// WHAT IT MIGRATES: today the GUEST locally CONSTRUCTS its post-battle tail
// (coop-replay-phases.ts maybeRunCoopWaveAdvance / finishTurn) - VictoryPhase /
// TrainerVictoryPhase / BattleEndPhase / NewBattlePhase / SelectBiomePhase / GameOverPhase +
// the ME-battle victory tail - by DERIVING it from a one-bit `waveResolved.outcome`. The host
// never STATES "the logical phase is now WAVE_VICTORY / REWARD_SELECT"; the guest infers it
// (§0 control-plane leak #1). This surface makes the HOST commit a WAVE_ADVANCE operation
// stating the COMPLETE transition (outcome, victory kind, next logicalPhase, next wave,
// biome-change, egg-lapse, ME-boundary) at its own wave-end; the GUEST adopts the committed
// op and constructs the SAME phases BY ADOPTION instead of DERIVATION.
//
// WHY IT IS DIFFERENT FROM biome/ME/reward: those are OWNER-ALTERNATED interaction relays; the
// wave-advance is HOST-DRIVEN (the host is the sole engine that resolves a wave). So the OWNER
// is ALWAYS the host seat (0), the OWNER commits at its own wave-end (broadcastCoopWaveResolved),
// and the guest is ALWAYS the watcher - it never mints/commits, it only gates adoption. The op
// is PINNED on the WAVE INDEX (one advance per wave), so cross-wave stale ordering is structural:
// a WAVE_ADVANCE for wave N when the guest already adopted N+1 is rejected (N < lastAppliedPinned),
// the typed successor of the legacy `lastResolvedWave` double-advance guard.
//
// DUAL-RUN (§1.8, §5.1): this rides ALONGSIDE the legacy path - the host keeps emitting
// waveResolved/waveEndState (which CARRY the data payload the guest adopts) unchanged, and the
// guest keeps the legacy `pending.outcome` derivation as the flag-OFF fallback. This layer is
// ADDITIVE control-plane bookkeeping + a watcher adoption gate. When the flag is OFF the surface
// behaves EXACTLY as before (pure legacy derivation). The #859/#860 phantom-dissolve + abort
// backstops REMAIN (this op supersedes their trigger but they stay as belt-and-suspenders).
//
// FLAG (§5.4): `isCoopWaveAdvanceOperationEnabled()`. Default ON, gated by the protocol-version
// protocol-version handshake as biome/ME/reward (COOP_PROTOCOL_VERSION; no new bump - no new wire
// arm, the wave decision's DATA still rides the existing waveResolved/waveEndState). CI/soak force
// legacy via COOP_WAVE_OP=off. State is per-session and reset on assembleCoopRuntime / clearCoopRuntime.
//
// FAIL-LOUD (§2.5 item 4, adversarial): a flag-ON guest with an op that fails to adopt for a
// NON-stale reason (a fail-closed unknown kind, a guest-applier gap) must FAIL LOUD - it must NOT
// silently fall to the raw `pending.outcome` derivation. Only the flag-OFF path derives. A stale/
// duplicate rejection is a legitimate skip (the wave already advanced), not a fail-loud.
// =============================================================================

import { canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import { COOP_CAP_OP_WAVE, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopWaveAdvancePayload,
  makeCoopOperationId,
  parseCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  getActiveCoopOperationDurability,
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
  registerCoopOperationApplier,
  routeCoopOperationToLiveSink,
  tryJournalCoopCommittedEnvelope,
  tryJournalCoopCommittedEnvelopeFor,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
  type CoopRuntimeOpState,
  getActiveCoopRuntimeOpState,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  requireCoopOpSurfaceStateFor,
  resetActiveCoopRuntimeClocks,
  withActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

/** The wave-advance operation kind this surface commits (the §2.5 item 4 keystone; host-driven). */
export type CoopWaveAdvanceOperationKind = Extract<CoopOperationKind, "WAVE_ADVANCE">;

/** The watcher's adoption verdict for a host-stated wave-advance. */
export type CoopWaveAdvanceAdoptDecision =
  /** Adopt the host-stated transition: construct the tail FROM `payload`, sanctioning `sanctionedTails` (§3 strict-tails). */
  | {
      readonly adopt: true;
      readonly payload: CoopWaveAdvancePayload;
      readonly sanctionedTails: readonly string[];
    }
  /**
   * Do NOT adopt. `stale` = a legitimate skip (the wave already advanced / duplicate) - the caller drops it.
   * `stale:false` = a FAIL-LOUD reject (fail-closed / guest-applier gap): the flag-ON caller must NOT derive.
   */
  | { readonly adopt: false; readonly reason: string; readonly stale: boolean };

// -----------------------------------------------------------------------------
// Flag + per-session state (reset on assembleCoopRuntime / clearCoopRuntime).
// -----------------------------------------------------------------------------

/**
 * Default ON. Activation is HARD-GATED by the protocol-version handshake shared with biome/ME/reward
 * (the COOP_PROTOCOL_VERSION check): a mixed-build pair refuses to pair / banners, so a live session has both
 * peers on the envelope build. The legacy derivation path remains selectable (rollback = set false). No new
 * wire arm is added, so no version bump is needed (the wave decision's DATA rides the existing waveResolved).
 */
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_WAVE_OP === "off");

let enabled = DEFAULT_ENABLED;

/** The host seat that DRIVES the wave-advance (conventionally 0 - the sole engine that resolves a wave). */
const HOST_SEAT = 0;

/**
 * Receiver-side copy of one complete retained wave transaction. The durability envelope is cloned before
 * storage because the engine's authoritative-state applier is allowed to normalize/mutate its input. DATA
 * and continuation readiness are separate latches: the operation cursor (and therefore coopAck) advances
 * only after both become true.
 */
export interface CoopStagedWaveAdvanceTransaction {
  readonly envelope: CoopAuthoritativeEnvelopeV1;
  readonly operationId: string;
  readonly canonicalEnvelope: string;
  readonly bootstrapProjected: boolean;
  readonly dataApplied: boolean;
  readonly continuationReady: boolean;
}

type MutableStagedWaveAdvanceTransaction = {
  envelope: CoopAuthoritativeEnvelopeV1;
  operationId: string;
  canonicalEnvelope: string;
  bootstrapProjected: boolean;
  dataApplied: boolean;
  continuationReady: boolean;
};

/** Every mutable wave cursor, retained receipt and boundary callback belongs to one assembled runtime. */
interface WaveAdvanceOpState {
  /** Session epoch used in the addressed operation id. */
  epoch: number;
  /** Surface-local persisted revision floor used to resume at N+1. */
  revisionFloor: number;
  /** Authority commit cursor for this runtime only. */
  authorityHost: CoopOperationHost | null;
  /** Receiver ordering/application cursor for this runtime only. */
  watchGuest: CoopOperationGuest | null;
  /** Highest wave this runtime's watcher has admitted. */
  lastAppliedWave: number;
  /** Exact immutable identity retained for every operation id seen by this runtime. */
  readonly stagedWaveTransactions: Map<string, MutableStagedWaveAdvanceTransaction>;
  /** The one deterministic WAVE_ADVANCE id retained for each resolved wave in this runtime. */
  readonly stagedWaveOperationIdByWave: Map<number, string>;
  /** Scene-bound DATA applier installed by this runtime's BattleEnd integration. */
  boundaryDataApplier: CoopWaveAdvanceBoundaryDataApplier | null;
}

registerCoopOpSurfaceState(
  "wave",
  (): WaveAdvanceOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    watchGuest: null,
    lastAppliedWave: -1,
    stagedWaveTransactions: new Map(),
    stagedWaveOperationIdByWave: new Map(),
    boundaryDataApplier: null,
  }),
);

/**
 * Engine module registration happens before a runtime exists. Keep that stateless production adapter as the
 * default, while runtime/test overrides live in the owning runtime record.
 */
let defaultBoundaryDataApplier: CoopWaveAdvanceBoundaryDataApplier | null = null;

/** Stable runtime selectors captured before a wave-end await, retry, phase callback, or boundary wake. */
export interface CoopWaveAdvanceOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Compact anomaly evidence for a BattleEnd that cannot find the retained transaction it is waiting on. */
export function describeCoopWaveAdvanceOperationBinding(binding: CoopWaveAdvanceOperationBinding): {
  readonly role: CoopRole | null;
  readonly stagedWaves: number[];
  readonly stagedOperationIds: string[];
} {
  const s = state(binding);
  return {
    role: binding.opState.localRole,
    stagedWaves: [...s.stagedWaveOperationIdByWave.keys()],
    stagedOperationIds: [...s.stagedWaveTransactions.keys()],
  };
}

/**
 * The one received wave transaction whose DATA has not reached BattleEnd yet. A phase binds to this durable
 * identity rather than ambient `currentBattle`, which an egg/biome tail may already have replaced.
 * Multiple unresolved waves are ambiguous and deliberately return null so the caller fails closed.
 */
export function getCoopPendingWaveAdvanceBoundary(
  binding?: CoopWaveAdvanceOperationBinding | null,
): { readonly wave: number; readonly victoryKind: CoopWaveAdvancePayload["victoryKind"] } | null {
  const unresolved = [...state(binding).stagedWaveTransactions.values()].filter(staged => !staged.dataApplied);
  if (unresolved.length !== 1) {
    return null;
  }
  const payload = unresolved[0].envelope.pendingOperation?.payload;
  if (!isValidCoopWaveAdvancePayload(payload)) {
    return null;
  }
  return { wave: payload.wave, victoryKind: payload.victoryKind };
}

/**
 * The one retained wave transaction whose public continuation has not opened yet. Unlike the BattleEnd
 * DATA selector above, this remains addressable after DATA applies so a reward/market/terminal surface
 * never falls back to a speculative future `currentBattle` while proving continuation readiness.
 */
export function getCoopPendingWaveContinuationBoundary(
  binding?: CoopWaveAdvanceOperationBinding | null,
): { readonly wave: number; readonly turn: number } | null {
  const unresolved = [...state(binding).stagedWaveTransactions.values()].filter(staged => !staged.continuationReady);
  if (unresolved.length !== 1) {
    return null;
  }
  const envelope = unresolved[0].envelope;
  const payload = envelope.pendingOperation?.payload;
  if (!isValidCoopWaveAdvancePayload(payload)) {
    return null;
  }
  return { wave: payload.wave, turn: envelope.authoritativeState.turn };
}

/** Missing or role-mismatched runtime state is a programming error, never a process-global fallback. */
export function captureCoopWaveAdvanceOperationBinding(expectedRole?: CoopRole): CoopWaveAdvanceOperationBinding {
  const opState = getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error("[coop-op] no runtime installed for surface=wave (cannot capture continuation binding)");
  }
  if (expectedRole != null && opState.localRole != null && opState.localRole !== expectedRole) {
    throw new Error(
      `[coop-op] surface=wave binding role=${opState.localRole} cannot execute localRole=${expectedRole}`,
    );
  }
  requireCoopOpSurfaceStateFor<WaveAdvanceOpState>(opState, "wave");
  return { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopWaveAdvanceOperationBinding | null): WaveAdvanceOpState {
  return binding == null
    ? requireCoopOpSurfaceState<WaveAdvanceOpState>("wave")
    : requireCoopOpSurfaceStateFor<WaveAdvanceOpState>(binding.opState, "wave");
}

function assertBindingRole(binding: CoopWaveAdvanceOperationBinding | null | undefined, role: CoopRole): void {
  const opState = binding?.opState ?? getActiveCoopRuntimeOpState();
  if (opState == null) {
    throw new Error(`[coop-op] no runtime installed for surface=wave localRole=${role}`);
  }
  if (opState.localRole != null && opState.localRole !== role) {
    throw new Error(`[coop-op] surface=wave binding role=${opState.localRole} cannot execute localRole=${role}`);
  }
}

function journalActive(binding?: CoopWaveAdvanceOperationBinding | null): boolean {
  return binding == null ? isCoopOperationJournalActive() : isCoopOperationJournalActiveFor(binding.durability);
}

function retainEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

function routeLiveSink(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  return binding == null
    ? routeCoopOperationToLiveSink("op:wave", envelope)
    : withActiveCoopRuntimeOpState(binding.opState, () => routeCoopOperationToLiveSink("op:wave", envelope));
}

/**
 * Engine-owned admission seam for the immutable post-BattleEnd DATA image. The wave adapter deliberately
 * does not import BattleScene/Phaser: BattleEndPhase installs the one production callback and decides
 * whether the currently active scene is still at an executable source-wave boundary. A deferred journal
 * retry can therefore finish DATA at the real BattleEnd phase, or at the source wave's already-open shared
 * reward/biome surface when scheduling delivered the first retry just after BattleEnd handed off.
 */
export type CoopWaveAdvanceBoundaryApplyOutcome = "deferred" | "applied" | "rejected";
export type CoopWaveAdvanceBoundaryDataApplier = (
  envelope: CoopAuthoritativeEnvelopeV1,
) => CoopWaveAdvanceBoundaryApplyOutcome;

/**
 * Install the engine-coupled retained-DATA boundary adapter. Returns an identity-fenced disposer so a
 * focused test may temporarily replace it without removing a newer production registration.
 */
export function registerCoopWaveAdvanceBoundaryDataApplier(
  applier: CoopWaveAdvanceBoundaryDataApplier,
  binding?: CoopWaveAdvanceOperationBinding | null,
): () => void {
  const s = binding == null ? maybeCoopOpSurfaceState<WaveAdvanceOpState>("wave") : state(binding);
  if (s == null) {
    const previous = defaultBoundaryDataApplier;
    defaultBoundaryDataApplier = applier;
    return () => {
      if (defaultBoundaryDataApplier === applier) {
        defaultBoundaryDataApplier = previous;
      }
    };
  }
  const previous = s.boundaryDataApplier;
  s.boundaryDataApplier = applier;
  return () => {
    if (s.boundaryDataApplier === applier) {
      s.boundaryDataApplier = previous;
    }
  };
}

/**
 * True iff the migrated (envelope-gated) wave-advance path is active; else pure legacy derivation (§5.1).
 * The local rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one
 * (#896 W2e-R2): if the peer did not advertise "opSurface.wave" it is not in the intersection and the surface
 * stays OFF on BOTH peers - a flag-flip / mixed build can never activate it one-sided. Pre-handshake (no
 * negotiated set yet) the capability gate is inert, so the local flag stands alone.
 */
export function isCoopWaveAdvanceOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_WAVE);
}

/** Select the migrated path (true) or the legacy derivation fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopWaveAdvanceOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopWaveAdvanceOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current wave-advance operation epoch (§1.4). Base epoch when no runtime is installed. */
export function getCoopWaveAdvanceOperationEpoch(binding?: CoopWaveAdvanceOperationBinding | null): number {
  return binding == null ? (maybeCoopOpSurfaceState<WaveAdvanceOpState>("wave")?.epoch ?? 1) : state(binding).epoch;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopWaveAdvanceOperationEpoch(next: number, binding?: CoopWaveAdvanceOperationBinding | null): void {
  const s = binding == null ? maybeCoopOpSurfaceState<WaveAdvanceOpState>("wave") : state(binding);
  if (s == null || !Number.isSafeInteger(next) || next <= 0 || next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopWaveAdvanceOperationState(binding);
}

/** Tear down all per-session operation state (called from assembleCoopRuntime + clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopWaveAdvanceOperationState(binding?: CoopWaveAdvanceOperationBinding | null): void {
  const s = binding == null ? maybeCoopOpSurfaceState<WaveAdvanceOpState>("wave") : state(binding);
  if (s == null) {
    return;
  }
  if (binding == null) {
    resetActiveCoopRuntimeClocks();
  } else {
    binding.opState.hostClock = null;
    binding.opState.guestClock = null;
  }
  s.authorityHost = null;
  s.watchGuest = null;
  s.lastAppliedWave = -1;
  s.revisionFloor = 0;
  s.stagedWaveTransactions.clear();
  s.stagedWaveOperationIdByWave.clear();
  s.boundaryDataApplier = null;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:wave"]`. Recreates the host
 * + guest so the producer continues at floor+1 and the guest accepts it (see {@linkcode revisionFloor}). A
 * no-op for a fresh session (floor 0). Idempotent for the same value.
 */
export function setCoopWaveAdvanceOperationRevisionFloor(
  hw: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): void {
  const s = binding == null ? maybeCoopOpSurfaceState<WaveAdvanceOpState>("wave") : state(binding);
  if (s == null || !Number.isFinite(hw) || hw <= 0 || hw === s.revisionFloor) {
    return;
  }
  s.revisionFloor = hw;
  // Recreate the host + guest so the new floor takes effect on next use (they were created at the old floor).
  s.authorityHost = null;
  s.watchGuest = null;
}

// -----------------------------------------------------------------------------
// Internals.
// -----------------------------------------------------------------------------

function host(binding?: CoopWaveAdvanceOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

/**
 * The ONE guest applier (W2e-R P0-2, coordinator directive): unlike the parked-era biome/ME/reward adapters -
 * which keep a SEPARATE journalGuest because they have no live sink and unifying would make the relay-adopt
 * path see the journal's operationId as already-applied and fall to the wrong fallback - the wave surface has
 * a LIVE MATERIALIZER (registerCoopOperationLiveSink), so the journal path can drive the real mutation. Both
 * the relay-adopt seam (adoptWaveAdvanceWatcherChoice) AND the journal-replay seam (applyJournaledWaveEnvelope)
 * feed THIS one applier, deduped by operationId (invariant 5). The materialization (the tail build) is deduped
 * SEPARATELY by lastResolvedWave (coop-runtime), so the tail is built exactly once regardless of which carrier
 * consumes the op first. See §8.6 addendum.
 */
function guest(binding?: CoopWaveAdvanceOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.watchGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.watchGuest;
}

/**
 * The owner validator (§1.3): the intent's owner seat MUST be the HOST seat. The wave-advance is host-driven
 * (the host is the sole engine that resolves a wave), so unlike the owner-alternated interaction surfaces
 * this is a fixed-seat check - the host refuses any wave-advance intent claiming a non-host owner.
 */
function hostSeatValidator(): CoopIntentValidator {
  return intent =>
    intent.owner === HOST_SEAT ? { ok: true } : { ok: false, reason: `wrong-owner:${intent.owner}!=${HOST_SEAT}` };
}

/**
 * The complete post-BattleEnd commit context. P33 binds the host-stated destination and the settled DATA
 * image in one retained envelope; a receiver rejects any wave/turn/tick mismatch before staging either.
 */
function controlContext(
  payload: CoopWaveAdvancePayload,
  authoritativeState: CoopAuthoritativeBattleStateV1,
): CoopCommitContext {
  return {
    wave: payload.wave,
    turn: authoritativeState.turn,
    logicalPhase: payload.nextLogicalPhase,
    authoritativeState,
  };
}

/** Compatibility-only DATA placeholder for a negotiated no-journal session. Never admitted by P33 preflight. */
function legacyControlState(wave: number, turn: number): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 0,
    wave,
    turn,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

/**
 * The TAIL phases the guest legitimately constructs for a given host-stated transition (§3 strict-tails,
 * §3.3 KEYSTONE group). Under the gate's strict-tails OBSERVE mode a boundary-tail phase NOT in the current
 * adopted op's sanctioned set logs `[coop:gate] TAIL WOULD-BLOCK` - the evidence-gathering signal that the
 * op's statement and the guest's construction diverge (mirroring the allowlist's WOULD-BLOCK rollout). This
 * is EVIDENCE-GATHERING only - never blocks. Pure over the payload; exported for the gate wiring + the test.
 */
export function coopWaveAdvanceSanctionedTails(payload: CoopWaveAdvancePayload): string[] {
  const tails: string[] = [];
  switch (payload.outcome) {
    case "win":
    case "capture": {
      // The win/capture VictoryPhase cascade. A terminal victory stays on this wave and hands off to
      // GameOver; a continuing victory is the only form allowed to construct NewBattle/NextEncounter.
      tails.push("VictoryPhase");
      if (payload.victoryKind === "trainer") {
        tails.push("TrainerVictoryPhase");
      }
      tails.push("BattleEndPhase");
      if (payload.nextWave === payload.wave) {
        tails.push("GameOverPhase");
      } else {
        tails.push("NewBattlePhase", "NextEncounterPhase");
      }
      break;
    }
    case "flee": {
      // The flee tail (no exp/rewards): BattleEnd -> (biome) -> NewBattle -> next encounter.
      tails.push("BattleEndPhase", "NewBattlePhase", "NextEncounterPhase");
      break;
    }
    case "gameOver": {
      tails.push("GameOverPhase");
      break;
    }
  }
  if (payload.biomeChange) {
    // WAVE_ADVANCE knows that a choice boundary exists, but cannot know its eventual destination. It may
    // authorize entering SelectBiome only; that phase must commit an exact BIOME_PICK before Switch/NewBiome.
    tails.push("SelectBiomePhase");
  }
  if (payload.eggLapse) {
    tails.push("EggLapsePhase");
  }
  if (payload.meBoundary === "battle-victory") {
    // An ME-spawned battle victory routes its own tail (#847), companion phases included.
    tails.push(
      "VictoryPhase",
      "MysteryEncounterRewardsPhase",
      "PostMysteryEncounterPhase",
      "MysteryEncounterBattlePhase",
      "MysteryEncounterBattleStartCleanupPhase",
    );
  }
  return tails;
}

/** Strict wire/journal validation for the complete host-stated transition. */
export function isValidCoopWaveAdvancePayload(value: unknown): value is CoopWaveAdvancePayload {
  const payload = value as CoopWaveAdvancePayload | undefined;
  if (
    payload == null
    || !Number.isSafeInteger(payload.wave)
    || payload.wave < 0
    || !Number.isSafeInteger(payload.nextWave)
    || typeof payload.biomeChange !== "boolean"
    || typeof payload.eggLapse !== "boolean"
    || (payload.meBoundary !== "none" && payload.meBoundary !== "battle-victory")
    || (payload.settledStateTick !== undefined
      && (!Number.isSafeInteger(payload.settledStateTick) || payload.settledStateTick < 0))
  ) {
    return false;
  }
  if (payload.outcome === "win" || payload.outcome === "capture") {
    const continues = payload.nextWave === payload.wave + 1;
    return (
      payload.nextLogicalPhase === "WAVE_VICTORY"
      && (payload.nextWave === payload.wave || payload.nextWave === payload.wave + 1)
      && (payload.victoryKind === "wild" || payload.victoryKind === "trainer")
      && (continues || (!payload.eggLapse && !payload.biomeChange))
    );
  }
  if (payload.outcome === "flee") {
    return (
      payload.nextLogicalPhase === "WAVE_FLEE"
      && payload.nextWave === payload.wave + 1
      && !payload.eggLapse
      && payload.victoryKind === undefined
    );
  }
  if (payload.outcome === "gameOver") {
    return (
      payload.nextLogicalPhase === "GAME_OVER"
      && payload.nextWave === payload.wave
      && !payload.biomeChange
      && !payload.eggLapse
      && payload.victoryKind === undefined
    );
  }
  return false;
}

/**
 * Validate the complete P33 control+DATA binding before the receiver stores anything. The looser payload
 * guard above intentionally still accepts an early legacy waveResolved hint with no settled tick; this
 * guard never does.
 */
export function isValidCoopSettledWaveAdvance(
  payload: CoopWaveAdvancePayload,
  authoritativeState: CoopAuthoritativeBattleStateV1,
): boolean {
  return (
    isValidCoopWaveAdvancePayload(payload)
    && Number.isSafeInteger(payload.settledStateTick)
    && payload.settledStateTick === authoritativeState.tick
    && authoritativeState.version === 1
    && Number.isSafeInteger(authoritativeState.tick)
    && authoritativeState.tick >= 0
    && authoritativeState.wave === payload.wave
    && Number.isSafeInteger(authoritativeState.turn)
    && authoritativeState.turn >= 0
    && Array.isArray(authoritativeState.playerParty)
    && Array.isArray(authoritativeState.enemyParty)
    && Array.isArray(authoritativeState.field)
    && Array.isArray(authoritativeState.arenaTags)
    && Array.isArray(authoritativeState.pokeballCounts)
    && Array.isArray(authoritativeState.playerModifiers)
    && Array.isArray(authoritativeState.enemyModifiers)
  );
}

/**
 * Normalize the engine's loose biome-boundary predicates to a strict wire boolean. Some game modes return
 * `undefined` from `isNewBiome()` on ordinary waves; `false || undefined` previously omitted biomeChange
 * during JSON serialization, so the guest rejected the entire victory transition and entered a phantom turn.
 */
export function resolveCoopBiomeBoundaryFlag(hasRandomBiomes: unknown, isNewBiome: unknown): boolean {
  return hasRandomBiomes === true || isNewBiome === true;
}

/** Resolve concrete victory-tail control from the authority statement, with local values only for legacy. */
export function resolveCoopVictoryTailControl(
  transition: CoopWaveAdvancePayload | null,
  local: { trainerWin: () => boolean; runContinues: () => boolean; biomeChange: () => boolean },
): { trainerWin: boolean; runContinues: boolean; eggLapse: boolean; biomeChange: boolean } {
  if (transition == null) {
    const runContinues = local.runContinues();
    return {
      trainerWin: local.trainerWin(),
      runContinues,
      eggLapse: runContinues,
      biomeChange: local.biomeChange(),
    };
  }
  return {
    trainerWin: transition.victoryKind === "trainer",
    runContinues: transition.nextWave === transition.wave + 1,
    eggLapse: transition.eggLapse,
    biomeChange: transition.biomeChange,
  };
}

// -----------------------------------------------------------------------------
// Owner (HOST) seam (§1.3 propose -> commit). Called at the host's wave-end.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Retained P33 transaction receiver (immutable DATA + exact continuation release).
// -----------------------------------------------------------------------------

export interface CoopWaveAdvanceEnvelopePreflight {
  readonly operationId: string;
  readonly payload: CoopWaveAdvancePayload;
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

/** Full-address and full-DATA validation for one retained WAVE_ADVANCE envelope. */
export function preflightCoopWaveAdvanceEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopWaveAdvanceEnvelopePreflight | null {
  const s = state(binding);
  const op = envelope.pendingOperation;
  const authoritativeState = envelope.authoritativeState as CoopAuthoritativeBattleStateV1 | null | undefined;
  if (
    envelope.version !== 1
    || !Number.isSafeInteger(envelope.sessionEpoch)
    || envelope.sessionEpoch !== s.epoch
    || !Number.isSafeInteger(envelope.revision)
    || envelope.revision <= 0
    || authoritativeState == null
    || typeof authoritativeState !== "object"
    || op == null
    || op.status !== "applied"
    || op.kind !== "WAVE_ADVANCE"
    || op.owner !== HOST_SEAT
    || !isValidCoopWaveAdvancePayload(op.payload)
  ) {
    return null;
  }
  const parsed = parseCoopOperationId(op.id);
  const payload = op.payload as CoopWaveAdvancePayload;
  if (
    parsed == null
    || parsed.epoch !== envelope.sessionEpoch
    || parsed.owner !== HOST_SEAT
    || parsed.kind !== "WAVE_ADVANCE"
    || parsed.pinnedSeq !== payload.wave
    || envelope.wave !== payload.wave
    || envelope.turn !== authoritativeState.turn
    || envelope.logicalPhase !== payload.nextLogicalPhase
    || !isValidCoopSettledWaveAdvance(payload, authoritativeState)
  ) {
    return null;
  }
  return { operationId: op.id, payload, authoritativeState };
}

export type CoopWaveAdvanceStageResult = "staged" | "duplicate" | "conflict" | "rejected";

/**
 * Store an immutable transaction only after the shared guest cursor has classified its address as the next
 * admissible envelope. Same-id/same-wave payload changes are conflicts, including after the first copy has
 * already completed; a forged retry can never borrow the original ACK.
 */
function stageCoopWaveAdvanceEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopWaveAdvanceStageResult {
  const s = state(binding);
  const preflight = preflightCoopWaveAdvanceEnvelope(envelope, binding);
  if (preflight == null || preflight.payload.wave < s.lastAppliedWave) {
    return "rejected";
  }
  const canonicalEnvelope = canonicalize(envelope);
  const existing = s.stagedWaveTransactions.get(preflight.operationId);
  if (existing != null) {
    return existing.canonicalEnvelope === canonicalEnvelope ? "duplicate" : "conflict";
  }
  const existingWaveId = s.stagedWaveOperationIdByWave.get(preflight.payload.wave);
  if (existingWaveId != null && existingWaveId !== preflight.operationId) {
    return "conflict";
  }
  const immutableEnvelope = structuredClone(envelope);
  s.stagedWaveTransactions.set(preflight.operationId, {
    envelope: immutableEnvelope,
    operationId: preflight.operationId,
    canonicalEnvelope,
    bootstrapProjected: false,
    dataApplied: false,
    continuationReady: false,
  });
  s.stagedWaveOperationIdByWave.set(preflight.payload.wave, preflight.operationId);
  return "staged";
}

/** Read a defensive copy of the retained transaction for a resolved wave. */
export function getCoopStagedWaveAdvanceTransaction(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopStagedWaveAdvanceTransaction | null {
  const s = state(binding);
  const id = s.stagedWaveOperationIdByWave.get(wave);
  const staged = id == null ? undefined : s.stagedWaveTransactions.get(id);
  return staged == null ? null : structuredClone(staged);
}

/** True only for the exact payload that came from the staged authoritative envelope. */
function isExactStagedWavePayload(
  payload: CoopWaveAdvancePayload,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  const staged = getCoopStagedWaveAdvanceTransaction(payload.wave, binding);
  const stagedPayload = staged?.envelope.pendingOperation?.payload;
  return stagedPayload != null && canonicalize(stagedPayload) === canonicalize(payload);
}

function mutateStagedWaveTransaction(
  wave: number,
  mutate: (stage: MutableStagedWaveAdvanceTransaction) => void,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  const s = state(binding);
  const id = s.stagedWaveOperationIdByWave.get(wave);
  const staged = id == null ? undefined : s.stagedWaveTransactions.get(id);
  if (staged == null) {
    return false;
  }
  mutate(staged);
  return true;
}

/** The durable op has made only its deterministic boundary bootstrap available (never a public UI yet). */
export function markCoopWaveAdvanceBootstrapProjected(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  return mutateStagedWaveTransaction(
    wave,
    stage => {
      stage.bootstrapProjected = true;
    },
    binding,
  );
}

/** The exact embedded authoritative state has applied successfully at the wave's safe boundary. */
export function markCoopWaveAdvanceDataApplied(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  return mutateStagedWaveTransaction(
    wave,
    stage => {
      stage.dataApplied = true;
    },
    binding,
  );
}

/**
 * Ask the engine-owned boundary adapter to apply this wave's exact retained state image. This is the only
 * late-admission path: the adapter must prove the live scene is either in BattleEnd or still on the source
 * wave with its real shared continuation UI open. It may never admit wave-N DATA after wave N+1 began.
 *
 * `applied` also covers an already-applied transaction, making BattleEnd start, deferred polling and the
 * public-UI wake freely repeatable. A callback may mutate the scene only from the immutable defensive copy;
 * the transaction's retained canonical envelope is never exposed for mutation.
 */
export function tryApplyCoopWaveAdvanceDataAtBoundary(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopWaveAdvanceBoundaryApplyOutcome {
  const s = state(binding);
  const id = s.stagedWaveOperationIdByWave.get(wave);
  const staged = id == null ? undefined : s.stagedWaveTransactions.get(id);
  const applier = s.boundaryDataApplier ?? defaultBoundaryDataApplier;
  if (staged == null || applier == null) {
    return "deferred";
  }
  if (staged.dataApplied) {
    return "applied";
  }
  let outcome: CoopWaveAdvanceBoundaryApplyOutcome;
  try {
    outcome = applier(structuredClone(staged.envelope));
  } catch (error) {
    coopWarn("runtime", `wave-advance retained DATA boundary adapter threw wave=${wave}`, error);
    return "rejected";
  }
  if (outcome !== "applied") {
    return outcome;
  }
  if (!markCoopWaveAdvanceDataApplied(wave, binding)) {
    return "rejected";
  }
  // The immutable DATA image has now landed at the real boundary: record the APPLICATION fact (separate
  // from the ordering-cursor advance done at staging), so a re-delivery of this exact wave-advance AFTER
  // its boundary is deduped via hasApplied - exactly as the former single-step apply did.
  guest(binding).markOperationApplied(staged.envelope);
  coopLog("runtime", `wave-advance retained DATA boundary admitted wave=${wave}`);
  return "applied";
}

/** A real destination UI/terminal/next-command surface is now active after DATA application. */
export function markCoopWaveAdvanceContinuationReady(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  const s = state(binding);
  const id = s.stagedWaveOperationIdByWave.get(wave);
  const staged = id == null ? undefined : s.stagedWaveTransactions.get(id);
  if (staged == null || !staged.dataApplied) {
    return false;
  }
  staged.continuationReady = true;
  return true;
}

/** ACK eligibility for the retained transaction. No earlier state is sufficient. */
export function isCoopWaveAdvanceTransactionComplete(
  wave: number,
  binding?: CoopWaveAdvanceOperationBinding | null,
): boolean {
  const staged = getCoopStagedWaveAdvanceTransaction(wave, binding);
  return staged?.dataApplied === true && staged.continuationReady === true;
}

export interface CoopWaveAdvanceOwnerCommitParams {
  /** The host-stated complete transition (§1.1). The host builds it from its own resolving battle state. */
  readonly payload: CoopWaveAdvancePayload;
  /** Settled post-BattleEnd DATA image causally bound by payload.settledStateTick. */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
  /** The local client's coop role - determines whether it is the authority that COMMITS (always host here). */
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}

/**
 * OWNER (HOST): mint + COMMIT the typed WAVE_ADVANCE intent through the operation primitive (§1.3). ADDITIVE
 * + dual-run: the host still emits waveResolved/waveEndState; this records the authoritative operation and
 * advances a surface-local revision (§1.5). No-op when the flag is OFF or the local client is not the host.
 * Never throws (the legacy derivation is the fallback).
 */
export function commitWaveAdvanceOwnerIntent(
  params: CoopWaveAdvanceOwnerCommitParams,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopAuthoritativeEnvelopeV1 | null {
  if (!isCoopWaveAdvanceOperationEnabled()) {
    return null;
  }
  assertBindingRole(binding, params.localRole);
  if (params.localRole !== "host") {
    return null;
  }
  if (
    params.wave !== params.payload.wave
    || params.turn !== params.authoritativeState.turn
    || !isValidCoopSettledWaveAdvance(params.payload, params.authoritativeState)
  ) {
    coopWarn("runtime", "wave-advance op HOST rejected incomplete/mismatched settled transaction", params);
    return null;
  }
  try {
    const s = state(binding);
    const intent: CoopPendingOperation = {
      // Pinned on the WAVE index (one advance per wave) - the cross-wave stale-ordering address.
      id: makeCoopOperationId(s.epoch, HOST_SEAT, params.payload.wave, "WAVE_ADVANCE"),
      kind: "WAVE_ADVANCE",
      owner: HOST_SEAT,
      status: "proposed",
      payload: params.payload,
    };
    const immutableState = structuredClone(params.authoritativeState);
    const res = host(binding).submit(intent, controlContext(params.payload, immutableState), hostSeatValidator());
    if (res.kind === "committed" || res.kind === "reack") {
      // COMMIT -> JOURNAL (Wave-2e/W2e-R): register the committed op with the durability journal so a lost
      // waveResolved is healed by the journal resend / reconnect tail -> the guest's live-sink materializer
      // (the FIRST production sink) rebuilds the tail. Rides ALONGSIDE the legacy waveResolved (dual-run);
      // no-op when durability is OFF. Under P33 the DATA is embedded in this exact retained envelope.
      if (!retainEnvelope(res.envelope, binding)) {
        coopWarn(
          "runtime",
          `wave-advance op HOST could not retain complete transaction wave=${params.payload.wave} id=${intent.id}`,
        );
        return null;
      }
      coopLog(
        "runtime",
        `wave-advance op HOST commit wave=${params.payload.wave} outcome=${params.payload.outcome} next=${params.payload.nextLogicalPhase} rev=${res.envelope.revision} id=${intent.id} (Wave-2f)`,
      );
      return res.envelope;
    }
    coopLog(
      "runtime",
      `wave-advance op HOST commit non-committed (${res.kind}) wave=${params.payload.wave} id=${intent.id} - legacy carries it (Wave-2f)`,
    );
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("runtime", "wave-advance op HOST commit threw (handled - legacy derivation is the fallback) (Wave-2f)", e);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Watcher (GUEST) seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopWaveAdvanceWatcherAdoptParams {
  /**
   * The host-stated transition the guest reconstructed from the received waveResolved/waveEndState + its
   * adopted battle state (battleType is host-authoritative per #867; isNewBiome is deterministic off the
   * adopted biome ops). Null = no wave-advance pending -> the caller does nothing.
   */
  readonly payload: CoopWaveAdvancePayload | null;
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}

/**
 * WATCHER (GUEST): gate the adoption of a host-stated wave-advance through the operation primitive. When the
 * flag is OFF this is a pass-through (adopt iff a payload landed) - pure legacy behavior. When ON:
 *   - gate application idempotently by operationId + the WAVE order (invariants 5, 6): a wave-advance for a
 *     wave STRICTLY BELOW the last adopted one (a stale leftover), or a re-delivery of an already-applied op
 *     (same operationId), is REJECTED with `stale:true` (a legitimate skip, the successor of lastResolvedWave);
 *   - a fail-closed unknown-kind or guest-applier gap is REJECTED with `stale:false` (FAIL-LOUD: the flag-ON
 *     caller must NOT silently derive the tail).
 * On adopt, returns the host-stated `payload` (the caller constructs the tail FROM it) + the sanctioned tail
 * phases (§3 strict-tails). Never throws (a throw -> `adopt:false`, stale:false = fail-loud).
 */
export function adoptWaveAdvanceWatcherChoice(
  params: CoopWaveAdvanceWatcherAdoptParams,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopWaveAdvanceAdoptDecision {
  if (params.payload == null) {
    return { adopt: false, reason: "no-payload", stale: true };
  }
  // Legacy / fallback: adopt the reconstructed payload verbatim, no operation gating (the caller then uses
  // the payload's outcome exactly as the legacy derivation used pending.outcome).
  if (!isCoopWaveAdvanceOperationEnabled()) {
    return { adopt: true, payload: params.payload, sanctionedTails: coopWaveAdvanceSanctionedTails(params.payload) };
  }
  if (!isValidCoopWaveAdvancePayload(params.payload)) {
    return { adopt: false, reason: "malformed-transition", stale: false };
  }
  // A captured continuation is an architectural ownership claim and must remain role-fenced even when the
  // ambient controller changes. The no-binding call is the temporary compatibility seam used by existing
  // synchronous phase code: a few engine tests (and the dev spoof runtime) deliberately change the
  // controller role after assembly, so its runtime record still carries the original role. It still fails
  // loudly when no runtime is installed via state()/guest() below; root wiring should pass a binding and
  // thereby opt into the strict role fence.
  if (binding != null) {
    assertBindingRole(binding, params.localRole);
  }
  try {
    const s = state(binding);
    const opId = makeCoopOperationId(s.epoch, HOST_SEAT, params.payload.wave, "WAVE_ADVANCE");

    // Stale / duplicate rejection (invariant 6, the successor of the lastResolvedWave double-advance guard):
    // a wave-advance for a wave STRICTLY BELOW the last adopted one (a leftover from an earlier wave), or a
    // re-delivery of an already-applied op (same operationId), can NEVER re-run the tail. The WAVE index is
    // monotonic across the run, so a legitimate current advance is always >= the last adopted one. This is a
    // LEGITIMATE skip (the wave already advanced), so stale:true.
    if (params.payload.wave < s.lastAppliedWave || guest(binding).hasApplied(opId)) {
      coopWarn(
        "runtime",
        `wave-advance op WATCHER REJECT stale/dup wave=${params.payload.wave} lastApplied=${s.lastAppliedWave} id=${opId} (Wave-2f)`,
      );
      return { adopt: false, reason: "stale-or-duplicate", stale: true };
    }

    if (journalActive(binding)) {
      if (!isExactStagedWavePayload(params.payload, binding)) {
        return { adopt: false, reason: "await-authoritative-envelope", stale: false };
      }
      // The exact retained envelope may bootstrap only the deterministic Victory/BattleEnd tail. It is NOT
      // applied/ACKed here: DATA application and the public continuation surface remain mandatory latches.
      return {
        adopt: true,
        payload: params.payload,
        sanctionedTails: coopWaveAdvanceSanctionedTails(params.payload),
      };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op). A fail-
    // closed unknown-kind or a guest-applier gap is a FAIL-LOUD reject (stale:false) - the caller must NOT
    // silently derive under the flag.
    const appliedOp: CoopPendingOperation = {
      id: opId,
      kind: "WAVE_ADVANCE",
      owner: HOST_SEAT,
      status: "applied",
      payload: params.payload,
    };
    const g = guest(binding);
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn,
      logicalPhase: params.payload.nextLogicalPhase,
      pendingOperation: appliedOp,
      authoritativeState: legacyControlState(params.wave, params.turn),
    });
    if (applyRes.kind !== "applied") {
      coopWarn(
        "runtime",
        `wave-advance op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> FAIL-LOUD (Wave-2f)`,
      );
      return { adopt: false, reason: `guest-${applyRes.kind}`, stale: false };
    }
    s.lastAppliedWave = params.payload.wave;
    coopLog(
      "runtime",
      `wave-advance op WATCHER adopt wave=${params.payload.wave} outcome=${params.payload.outcome} next=${params.payload.nextLogicalPhase} id=${opId} (Wave-2f)`,
    );
    return { adopt: true, payload: params.payload, sanctionedTails: coopWaveAdvanceSanctionedTails(params.payload) };
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("runtime", "wave-advance op WATCHER gate threw (handled - FAIL-LOUD) (Wave-2f)", e);
    return { adopt: false, reason: "threw", stale: false };
  }
}

// -----------------------------------------------------------------------------
// Journal replay seam (Wave-2e/W2e-R, §4.2/§4.4 + §8.6): route a resent / reconnect-tail committed
// WAVE_ADVANCE envelope INTO the ONE guest applier (invariant 5) AND the LIVE-MUTATION sink. This is the
// FIRST surface whose journal applier drives a REAL live materialization (the reviewer's central demand):
// the sink (registered from coop-runtime) rebuilds the guest's wave-advance tail from the host-stated op.
// -----------------------------------------------------------------------------

/**
 * Apply a committed WAVE_ADVANCE envelope delivered by the durability journal (a resend or reconnect tail).
 * ONE LEDGER (W2e-R P0-2, coordinator directive): routes into the SAME {@linkcode CoopOperationGuest} the
 * relay-adopt path (adoptWaveAdvanceWatcherChoice) uses, deduped by operationId - so a dual-run duplicate
 * (the live waveResolved already adopted it) is a no-op. Re-keyed to the guest-local dense revision (not the
 * envelope's host revision) so the one shared applier stays on a single monotonic stream. When it NEWLY
 * consumes an op it routes into the live-mutation sink (materialize the tail on the guest). Returns a
 * {@linkcode CoopApplyOutcome} that GATES the durability ACK (W2e-R P0-1): `applied` (newly consumed - ACK +
 * advance), `duplicate` (already consumed - ACK so a resend cannot spin), `deferred` (valid DATA or exact
 * continuation surface is not ready yet - retain without error recovery), or `rejected` (invalid/conflicting
 * transaction - bounded recovery). Never throws.
 */
function applyJournaledWaveEnvelope(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding?: CoopWaveAdvanceOperationBinding | null,
): CoopApplyOutcome {
  // A consistent peer cannot send this while the surface is disabled. Refuse without ACKing instead of
  // permanently discarding an authoritative mutation.
  if (!isCoopWaveAdvanceOperationEnabled()) {
    return "rejected";
  }
  const s = state(binding);
  const preflight = preflightCoopWaveAdvanceEnvelope(envelope, binding);
  if (preflight == null) {
    return "rejected";
  }
  const existing = s.stagedWaveTransactions.get(preflight.operationId);
  if (existing != null && existing.canonicalEnvelope !== canonicalize(envelope)) {
    coopWarn("runtime", `wave-advance op JOURNAL conflicting same-id envelope id=${preflight.operationId}`);
    return "rejected";
  }
  const g = guest(binding);
  const inspected = g.inspectEnvelope(envelope);
  if (inspected.kind === "duplicate") {
    return "duplicate";
  }
  if (inspected.kind !== "applied") {
    return "rejected";
  }
  const staged = stageCoopWaveAdvanceEnvelope(envelope, binding);
  if (staged === "conflict" || staged === "rejected") {
    return "rejected";
  }
  // Once RECEIVED + STAGED, the staged transaction OWNS this wave's lifecycle: its DATA applies ONLY at the
  // real BattleEnd boundary (BattleEndPhase is the deterministic wake - battle-end-phase.ts - not a retry
  // timer) and its continuation latch is marked separately (maybeMarkCoopWaveContinuationReady). The journal
  // cursor must therefore NOT wait on dataApplied/continuationReady: holding it there double-gates the staged
  // transaction's job onto the SHARED receive cursor and DEADLOCKS the same-boundary reward RESULT
  // (op:global seq+1), which has to apply at the PRE-BattleEnd shop for the guest to reach BattleEnd at all
  // (soak seed 987654321 wave 1: "owner terminal never arrived"). The WAVE_ADVANCE plain ACK is already
  // continuation-safe (coop-durability.ts:670-672); layering the UI stages on top is the redundant gate.
  //
  // A genuinely-absent revision never reaches here - inspectEnvelope above gates on rev == clock+1 - so
  // advancing the cursor is conditional on the op being RECEIVED, never mere absence: global-revision gap
  // detection / resync are unaffected.
  //
  // Advance ONLY the shared ORDERING cursor - NOT the application ledger - and do it BEFORE the boundary DATA
  // block below. Marking the wave-advance `hasApplied` here (as a full applyEnvelope would) is premature: its
  // DATA lands only at the real BattleEnd boundary, and a premature `hasApplied` makes
  // adoptWaveAdvanceWatcherChoice reject the exact staged wave-advance as a duplicate ("WATCHER REJECT
  // stale/dup"), starving the watcher. The eager cursor advance is also what keeps the same-boundary reward
  // RESULT at rev+1 from being a spurious GAP. ORDER MATTERS (the wave-first regression the duo reward tests
  // caught): when the watcher already sits at THIS wave's public boundary (its reward SelectModifierPhase),
  // the boundary block below applies the DATA in-line and calls markOperationApplied, which bumps the shared
  // clock to THIS revision - so advancing the cursor AFTER it would re-inspect this same envelope as
  // `rev <= clock` (duplicate), wrongly return "rejected", and stall op:global so the watcher's same-boundary
  // reward terminal never arrives. Advancing FIRST makes that later markOperationApplied a monotonic clock
  // no-op that only records appliedIds; the application fact still lands solely at the real boundary, and a
  // re-delivery before the boundary is still deduped by the clock (rev <= clock -> the duplicate return above).
  if (g.advanceRevisionOrdering(envelope).kind !== "applied") {
    return "rejected";
  }
  // Project the bootstrap into pendingWaveAdvance now, and admit the DATA immediately when the guest ALREADY
  // sits at the boundary (a resent/reconnect-tail envelope, or a watcher parked at its reward shop) so that
  // fast path stays exact - but never GATE the cursor on it (the cursor already advanced above).
  if (!getCoopStagedWaveAdvanceTransaction(preflight.payload.wave, binding)?.dataApplied) {
    const sinkReady = routeLiveSink(envelope, binding);
    if (!sinkReady) {
      const dataOutcome = tryApplyCoopWaveAdvanceDataAtBoundary(preflight.payload.wave, binding);
      if (dataOutcome === "rejected") {
        return "rejected";
      }
      if (dataOutcome === "applied") {
        routeLiveSink(envelope, binding);
      }
    }
  }
  if (preflight.payload.wave > s.lastAppliedWave) {
    s.lastAppliedWave = preflight.payload.wave;
  }
  const stagedTxn = getCoopStagedWaveAdvanceTransaction(preflight.payload.wave, binding);
  coopLog(
    "runtime",
    `wave-advance op JOURNAL cursor-advanced id=${preflight.operationId} rev=${envelope.revision} `
      + `dataApplied=${stagedTxn?.dataApplied === true} continuationReady=${stagedTxn?.continuationReady === true} `
      + "(DATA applies at BattleEnd; plain ACK is continuation-safe)",
  );
  return "applied";
}

/**
 * Explicit receiver entrypoint for a durability callback that captured its runtime before asynchronous
 * delivery. The role fence prevents a retained wave from advancing the authority runtime's receive ledger.
 */
export function applyCoopWaveAdvanceEnvelopeForBinding(
  envelope: CoopAuthoritativeEnvelopeV1,
  binding: CoopWaveAdvanceOperationBinding,
): CoopApplyOutcome {
  assertBindingRole(binding, "guest");
  return applyJournaledWaveEnvelope(envelope, binding);
}

// Register the wave-advance guest applier so the durability manager can route a resent / reconnect-tail
// `op:wave` envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:wave", applyJournaledWaveEnvelope);

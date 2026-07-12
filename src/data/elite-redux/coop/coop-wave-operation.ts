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

import { COOP_CAP_OP_WAVE, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopWaveAdvancePayload,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  isCoopOperationJournalActive,
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
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

/**
 * The session epoch (§1.4). Wave-2f keeps it constant (1) per session and resets the surface state on session
 * boundaries; the full launch/resume epoch mint is a later cross-surface piece (§2.4). An epoch change still
 * bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
 */
let epoch = 1;

/** The host seat that DRIVES the wave-advance (conventionally 0 - the sole engine that resolves a wave). */
const HOST_SEAT = 0;

/** The authority (coop host) commit log for wave-advance ops. Lazily created; null until first use / on a non-host. */
let authorityHost: CoopOperationHost | null = null;

/** The watcher applier that gates adoption of a host-stated wave-advance. Lazily created; null until first use. */
let watchGuest: CoopOperationGuest | null = null;

/**
 * The highest WAVE index the local client has already ADOPTED a wave-advance op for AS A WATCHER (the typed
 * successor of the legacy `lastResolvedWave`). Cross-wave stale ordering runs on this: a wave-advance for a
 * wave STRICTLY BELOW it is a stale leftover from an earlier wave (§1.6). Advanced ONLY by a watcher adoption
 * - never by the host's own commit. -1 = none yet.
 */
let lastAppliedWave = -1;

/**
 * The surface-local revision FLOOR (W2e-R P0-3). On a COLD resume the durability receiver ledger is restored
 * to the persisted per-class high-water N (coop-runtime.ts applyCoopControlPlaneSaveData), but this surface's
 * CoopOperationHost + guest applier are recreated at revision 0 - so the producer would emit revision 1 and
 * the restored receiver would drop it as a stale duplicate. Flooring the host + guest to N makes the producer
 * continue at N+1 and the guest accept it, keeping the committed-op revision stream MONOTONIC across the save
 * boundary (§4.6; the epoch is unchanged, so the restored receiver marks stay valid). 0 = fresh session.
 */
let revisionFloor = 0;

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

/** The current wave-advance operation epoch (§1.4). */
export function getCoopWaveAdvanceOperationEpoch(): number {
  return epoch;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopWaveAdvanceOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopWaveAdvanceOperationState();
}

/** Tear down all per-session operation state (called from assembleCoopRuntime + clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopWaveAdvanceOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  authorityHost = null;
  watchGuest = null;
  lastAppliedWave = -1;
  revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:wave"]`. Recreates the host
 * + guest so the producer continues at floor+1 and the guest accepts it (see {@linkcode revisionFloor}). A
 * no-op for a fresh session (floor 0). Idempotent for the same value.
 */
export function setCoopWaveAdvanceOperationRevisionFloor(hw: number): void {
  if (!Number.isFinite(hw) || hw <= 0 || hw === revisionFloor) {
    return;
  }
  revisionFloor = hw;
  // Recreate the host + guest so the new floor takes effect on next use (they were created at the old floor).
  authorityHost = null;
  watchGuest = null;
}

// -----------------------------------------------------------------------------
// Internals.
// -----------------------------------------------------------------------------

function host(): CoopOperationHost {
  if (authorityHost == null) {
    authorityHost = CoopOperationHost.global({ epoch, initialRevision: revisionFloor });
  }
  return authorityHost;
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
function guest(): CoopOperationGuest {
  if (watchGuest == null) {
    watchGuest = CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  }
  return watchGuest;
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
 * A minimal control-plane commit context. Wave-2f's wave decision carries no NEW data-plane payload over the
 * wire (the party/field/money/progression travels on the existing per-turn checkpoint + waveEndState,
 * dual-run), so the embedded authoritativeState is a lightweight placeholder the applier never reads (it
 * classifies on the CONTROL fields only). The real adopt-by-id state apply is UNCHANGED (§1.2). The
 * logicalPhase is the host-stated NEXT phase the transition enters (WAVE_VICTORY / WAVE_FLEE / GAME_OVER),
 * so the envelope makes logicalPhase host-authoritative - the keystone.
 */
function controlContext(payload: CoopWaveAdvancePayload, wave: number, turn: number): CoopCommitContext {
  const placeholder: CoopAuthoritativeBattleStateV1 = {
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
  return { wave, turn, logicalPhase: payload.nextLogicalPhase, authoritativeState: placeholder };
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
      // The win/capture VictoryPhase cascade: Victory -> (Trainer) -> BattleEnd -> reward -> NewBattle -> next encounter.
      tails.push("VictoryPhase");
      if (payload.victoryKind === "trainer") {
        tails.push("TrainerVictoryPhase");
      }
      tails.push("BattleEndPhase", "NewBattlePhase", "NextEncounterPhase");
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
    // A biome boundary adds the biome-transition tail (references the BIOME_SELECT ops, #863/#864).
    tails.push("SelectBiomePhase", "NewBiomeEncounterPhase", "SwitchBiomePhase");
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
  ) {
    return false;
  }
  if (payload.outcome === "win" || payload.outcome === "capture") {
    return (
      payload.nextLogicalPhase === "WAVE_VICTORY"
      && payload.nextWave === payload.wave + 1
      && (payload.victoryKind === "wild" || payload.victoryKind === "trainer")
    );
  }
  if (payload.outcome === "flee") {
    return payload.nextLogicalPhase === "WAVE_FLEE" && payload.nextWave === payload.wave + 1;
  }
  if (payload.outcome === "gameOver") {
    return payload.nextLogicalPhase === "GAME_OVER" && payload.nextWave === payload.wave;
  }
  return false;
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

export interface CoopWaveAdvanceOwnerCommitParams {
  /** The host-stated complete transition (§1.1). The host builds it from its own resolving battle state. */
  readonly payload: CoopWaveAdvancePayload;
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
export function commitWaveAdvanceOwnerIntent(params: CoopWaveAdvanceOwnerCommitParams): void {
  if (!isCoopWaveAdvanceOperationEnabled() || params.localRole !== "host") {
    return;
  }
  if (!isValidCoopWaveAdvancePayload(params.payload)) {
    coopWarn("runtime", "wave-advance op HOST rejected malformed transition before commit", params.payload);
    return;
  }
  try {
    const intent: CoopPendingOperation = {
      // Pinned on the WAVE index (one advance per wave) - the cross-wave stale-ordering address.
      id: makeCoopOperationId(epoch, HOST_SEAT, params.payload.wave, "WAVE_ADVANCE"),
      kind: "WAVE_ADVANCE",
      owner: HOST_SEAT,
      status: "proposed",
      payload: params.payload,
    };
    const res = host().submit(intent, controlContext(params.payload, params.wave, params.turn), hostSeatValidator());
    if (res.kind === "committed") {
      // COMMIT -> JOURNAL (Wave-2e/W2e-R): register the committed op with the durability journal so a lost
      // waveResolved is healed by the journal resend / reconnect tail -> the guest's live-sink materializer
      // (the FIRST production sink) rebuilds the tail. Rides ALONGSIDE the legacy waveResolved (dual-run);
      // no-op when durability is OFF. The DATA still travels on waveResolved/waveEndState (§1.2).
      journalCoopCommittedEnvelope(res.envelope);
      coopLog(
        "runtime",
        `wave-advance op HOST commit wave=${params.payload.wave} outcome=${params.payload.outcome} next=${params.payload.nextLogicalPhase} rev=${res.envelope.revision} id=${intent.id} (Wave-2f)`,
      );
    } else {
      coopLog(
        "runtime",
        `wave-advance op HOST commit non-committed (${res.kind}) wave=${params.payload.wave} id=${intent.id} - legacy carries it (Wave-2f)`,
      );
    }
  } catch (e) {
    coopWarn("runtime", "wave-advance op HOST commit threw (handled - legacy derivation is the fallback) (Wave-2f)", e);
  }
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
export function adoptWaveAdvanceWatcherChoice(params: CoopWaveAdvanceWatcherAdoptParams): CoopWaveAdvanceAdoptDecision {
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
  try {
    const opId = makeCoopOperationId(epoch, HOST_SEAT, params.payload.wave, "WAVE_ADVANCE");

    // Stale / duplicate rejection (invariant 6, the successor of the lastResolvedWave double-advance guard):
    // a wave-advance for a wave STRICTLY BELOW the last adopted one (a leftover from an earlier wave), or a
    // re-delivery of an already-applied op (same operationId), can NEVER re-run the tail. The WAVE index is
    // monotonic across the run, so a legitimate current advance is always >= the last adopted one. This is a
    // LEGITIMATE skip (the wave already advanced), so stale:true.
    if (params.payload.wave < lastAppliedWave || guest().hasApplied(opId)) {
      coopWarn(
        "runtime",
        `wave-advance op WATCHER REJECT stale/dup wave=${params.payload.wave} lastApplied=${lastAppliedWave} id=${opId} (Wave-2f)`,
      );
      return { adopt: false, reason: "stale-or-duplicate", stale: true };
    }

    if (isCoopOperationJournalActive()) {
      return { adopt: false, reason: "await-authoritative-envelope", stale: false };
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
    const g = guest();
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn,
      logicalPhase: params.payload.nextLogicalPhase,
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.payload, params.wave, params.turn).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn(
        "runtime",
        `wave-advance op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> FAIL-LOUD (Wave-2f)`,
      );
      return { adopt: false, reason: `guest-${applyRes.kind}`, stale: false };
    }
    lastAppliedWave = params.payload.wave;
    coopLog(
      "runtime",
      `wave-advance op WATCHER adopt wave=${params.payload.wave} outcome=${params.payload.outcome} next=${params.payload.nextLogicalPhase} id=${opId} (Wave-2f)`,
    );
    return { adopt: true, payload: params.payload, sanctionedTails: coopWaveAdvanceSanctionedTails(params.payload) };
  } catch (e) {
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
 * advance), `duplicate` (already consumed / non-applicable / flag-off - ACK so a resend cannot spin), or
 * `rejected` (transient - do NOT ACK, retriable). Never throws.
 */
function applyJournaledWaveEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  // A consistent peer cannot send this while the surface is disabled. Refuse without ACKing instead of
  // permanently discarding an authoritative mutation.
  if (!isCoopWaveAdvanceOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op == null || op.status !== "applied" || op.kind !== "WAVE_ADVANCE") {
    return "rejected";
  }
  if (!isValidCoopWaveAdvancePayload(op.payload)) {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate"; // the relay-adopt path or a prior journal delivery already consumed it - ACK, no re-apply.
  }
  if (applyCoopOperationEnvelope(g, "op:wave", envelope) !== "applied") {
    // A transient non-applicable result (fail-closed / gap): leave it retriable (do NOT ACK). Never a
    // permanent condition (a permanent one is the duplicate above).
    return "rejected";
  }
  const payload = op.payload as CoopWaveAdvancePayload;
  if (typeof payload?.wave === "number" && payload.wave > lastAppliedWave) {
    lastAppliedWave = payload.wave;
  }
  // W2e-R P0-1: the production sink already accepted this operation above, before the sidecar ledger moved.
  coopLog("runtime", `wave-advance op JOURNAL apply id=${op.id} rev=${envelope.revision} (Wave-2f/W2e-R)`);
  return "applied";
}

// Register the wave-advance guest applier so the durability manager can route a resent / reconnect-tail
// `op:wave` envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:wave", applyJournaledWaveEnvelope);

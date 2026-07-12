/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op BIOME-TRAVEL operation surface (Wave-2a authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §2.5 item 1 + §5.1).
//
// This is the FIRST production wiring of the authoritative operation model
// (coop-operation-runtime.ts) onto a live control surface: biome travel - the ER
// World-Map biomePick (#15) + the crossroads Stay/Leave (#14). It is the TEMPLATE
// every later surface copies (§7).
//
// WHAT IT DOES (control plane only - adjudication (a): the DATA plane is untouched):
//   - OWNER: mints a TYPED intent (invariant 2) for the biome/crossroads pick and,
//     on the AUTHORITY (coop host), COMMITS it EXACTLY ONCE through CoopOperationHost
//     (invariant 3), advancing a surface-local revision (§1.5).
//   - WATCHER: gates its adoption of the relayed pick through CoopOperationGuest -
//     idempotent by operationId (invariant 5), late-/stale-rejecting a pick from an
//     earlier interaction or a prior epoch (invariant 6, the #861 shape).
//
// DUAL-RUN (§1.8, §5.1): this rides ALONGSIDE the legacy relay, which the phases keep
// firing unchanged. The legacy `biomePick`/`crossroads` relay + the interaction counter
// stay LIVE (removing them is FORBIDDEN until every surface is migrated); this layer is
// ADDITIVE control-plane bookkeeping + a watcher adoption gate. When the flag is OFF the
// surface behaves EXACTLY as before (pure legacy fallback).
//
// FLAG (adjudication (b), §5.4): `isCoopBiomeOperationEnabled()`. Default ON, gated by the
// #806 protocol-version handshake (COOP_PROTOCOL_VERSION bump): paired clients share the
// version, so a session is either both-envelope or both-legacy, never half-and-half. The
// legacy path stays selectable - `setCoopBiomeOperationEnabled(false)` is the one-line
// per-surface rollback (§5.4). State is per-session and reset on clearCoopRuntime.
//
// DESIGN DELTA vs the doc (recorded in §7 "how to migrate a surface"): Wave-2a rides the
// envelope's CONTROL fields over the EXISTING relay carrier (dual-run) rather than a new
// `envelope` wire message - the biome decision's DATA still travels on the existing
// per-turn checkpoint / waveEndState (§1.2 keeps the data apply as-is; the `envelope`
// message arm is declared for the journal wave, Wave-2b). And the surface-local revision
// advances +1 per biome/crossroads op (not the GLOBAL dense revision of §1.5, which lands
// only when every surface is migrated); cross-op stale ordering is enforced on the pinned
// interaction counter, which the counter advances in lockstep (§1.8).
// =============================================================================

import { COOP_CAP_OP_BIOME, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopBiomePickPayload,
  type CoopCrossroadsPickPayload,
  type CoopOperationKind,
  type CoopPendingOperation,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  journalCoopCommittedEnvelope,
  registerCoopOperationApplier,
  routeCoopOperationToLiveSink,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

/** The biome-travel operation kinds this surface commits (the §2 successors of biomePick / crossroads). */
export type CoopBiomeOperationKind = Extract<CoopOperationKind, "BIOME_PICK" | "CROSSROADS_PICK">;

/** The awaited relay result shape the watcher gates (a subset of CoopInteractionChoice - seq/kind/choice/data). */
export interface CoopBiomeRelayResult {
  readonly choice: number;
  readonly data?: number[] | undefined;
}

/** The watcher's adoption verdict for a relayed biome/crossroads pick. */
export type CoopBiomeAdoptDecision =
  /** Adopt the relayed pick verbatim (its choice index + biome data). */
  | { readonly adopt: true; readonly choice: number; readonly data: number[] | undefined }
  /** Do NOT adopt (stale / duplicate / rejected / cross-epoch / fail-closed): fall to the deterministic backstop. */
  | { readonly adopt: false; readonly reason: string };

// -----------------------------------------------------------------------------
// Flag + per-session state (reset on clearCoopRuntime).
// -----------------------------------------------------------------------------

/**
 * Default ON. Activation is HARD-GATED by the #806 protocol-version handshake (the
 * COOP_PROTOCOL_VERSION bump): a mixed-build pair refuses to pair / banners, so a live session
 * has both peers on the envelope build. The legacy path remains selectable (rollback = set false).
 */
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_BIOME_OP === "off");

let enabled = DEFAULT_ENABLED;

/**
 * The session epoch (§1.4). Wave-2a keeps it constant (1) per session and resets the surface state on
 * clearCoopRuntime; the full launch/resume epoch mint is a later, cross-surface piece (§2.4). An epoch
 * change still bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
 */
let epoch = 1;

/** The authority (coop host) commit log for biome-travel ops. Lazily created; null until first use / on a non-host. */
let authorityHost: CoopOperationHost | null = null;

/** The watcher applier that gates adoption of a relayed pick. Lazily created; null until first use. */
let watchGuest: CoopOperationGuest | null = null;

/**
 * Journal-consumed operationIds whose production live sink has fed the committed choice into the real
 * biome/crossroads phase path, but whose phase has not adopted that choice yet. This bridges the intentional
 * safe-boundary handoff: the ONE ledger consumes first in the durability handler, then the phase consumes
 * this marker exactly once instead of mistaking the committed choice for an ordinary duplicate and falling
 * into the deterministic (potentially wrong-biome) fallback.
 */
const pendingJournalMaterializations = new Set<string>();

/** Arm the one safe-boundary phase handoff after the production sink accepted this committed operation. */
export function armCoopBiomeJournalMaterialization(operationId: string): void {
  pendingJournalMaterializations.add(operationId);
}

/**
 * The highest interaction-counter (pinned) value the local client has already ADOPTED a biome-travel op at
 * AS A WATCHER. Cross-op stale ordering runs on this (a pick pinned strictly BELOW it is a stale leftover
 * from an earlier interaction, §1.6). Advanced ONLY by a watcher adoption - never by the owner's own commit,
 * so the owner-commit + watcher-adopt of the SAME interaction never contaminate each other. -1 = none yet.
 */
let lastAppliedPinned = -1;

/**
 * The surface-local revision FLOOR (W2e-R P0-3). On a COLD resume the durability receiver ledger is restored
 * to the persisted per-class high-water N (coop-runtime.ts applyCoopControlPlaneSaveData), but the surface's
 * CoopOperationHost + guest appliers are recreated at revision 0 - so the producer would emit revision 1 and
 * the restored receiver would drop it as a stale duplicate (isDuplicate: 1 <= N). Flooring the host + guests
 * to N makes the producer continue at N+1 and the guests accept it, keeping the committed-op revision stream
 * MONOTONIC across the save boundary (§4.6 - the same monotonic-continue contract the counter/high-water use;
 * the epoch is unchanged, so the restored receiver marks stay valid). 0 = fresh session (no resume).
 */
let revisionFloor = 0;

/**
 * True iff the migrated (envelope-gated) biome-travel path is active; else pure legacy fallback (§5.1).
 * The local rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one
 * (#896 W2e-R2): if the peer did not advertise "opSurface.biome", it is not in the intersection and the
 * surface stays OFF on BOTH peers - so a flag-flip / mixed build can never activate it one-sided. Pre-
 * handshake (no negotiated set yet) the capability gate is inert, so the local flag stands alone.
 */
export function isCoopBiomeOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BIOME);
}

/** Select the migrated path (true) or the legacy relay fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopBiomeOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopBiomeOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current biome-travel operation epoch (§1.4). */
export function getCoopBiomeOperationEpoch(): number {
  return epoch;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopBiomeOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopBiomeOperationState();
}

/** Tear down all per-session operation state (called from clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopBiomeOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  authorityHost = null;
  watchGuest = null;
  pendingJournalMaterializations.clear();
  lastAppliedPinned = -1;
  revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:biome"]`. Recreates the
 * host + guests so the producer continues at floor+1 and the guests accept it (see {@linkcode revisionFloor}).
 * A no-op for a fresh session (floor 0). Idempotent for the same value.
 */
export function setCoopBiomeOperationRevisionFloor(hw: number): void {
  if (!Number.isFinite(hw) || hw <= 0 || hw === revisionFloor) {
    return;
  }
  revisionFloor = hw;
  // Recreate the host + guests so the new floor takes effect on next use (they were created at the old floor).
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

function guest(): CoopOperationGuest {
  if (watchGuest == null) {
    watchGuest = CoopOperationGuest.global({ epoch, initialRevision: revisionFloor });
  }
  return watchGuest;
}

/**
 * The owner-parity validator (§1.3): the intent's owner seat MUST be the seat the interaction counter
 * assigns for this pinned slot. This is the typed successor of `isLocalOwnerAtCounter` - the host refuses
 * an intent from the wrong seat instead of trusting the sender (removing the "guest re-derives owner" hazard).
 */
function ownerParityValidator(pinned: number): CoopIntentValidator {
  const expectedSeat = coopInteractionOwnerSeat(pinned);
  return intent =>
    intent.owner === expectedSeat
      ? { ok: true }
      : { ok: false, reason: `wrong-owner:${intent.owner}!=${expectedSeat}` };
}

/**
 * A minimal control-plane commit context. Wave-2a's biome decision carries no NEW data-plane payload over
 * the wire (the mon/field state travels on the existing checkpoint, dual-run), so the embedded
 * authoritativeState is a lightweight placeholder the applier never reads (it classifies on the CONTROL
 * fields only). The real adopt-by-id state apply is UNCHANGED (adjudication (a), §1.2).
 */
function controlContext(wave: number, turn: number): CoopCommitContext {
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
  return { wave, turn, logicalPhase: "BIOME_SELECT", authoritativeState: placeholder };
}

// -----------------------------------------------------------------------------
// Owner seam (§1.3 propose -> commit).
// -----------------------------------------------------------------------------

export interface CoopBiomeOwnerCommitParams {
  readonly kind: CoopBiomeOperationKind;
  /** The relay address (BASE + pinned) - the globally-unique interaction address, the operationId suffix (§2.2). */
  readonly seq: number;
  /** The interaction counter this op is pinned at (§2.2). */
  readonly pinned: number;
  /** The chosen option/route index (the biome node index, or Stay=0 / Leave=1). */
  readonly choice: number;
  /** The typed payload (§1.1 discriminated per kind). */
  readonly payload: CoopBiomePickPayload | CoopCrossroadsPickPayload;
  /** The local client's coop role - determines whether it is the authority that COMMITS. */
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}

/**
 * OWNER TERMINAL: mint + (on the authority) COMMIT the typed biome-travel intent through the operation
 * primitive (§1.3). ADDITIVE + dual-run: the phase still fires the legacy relay send; this records the
 * authoritative operation. No-op when the flag is OFF. Never throws (the legacy relay is the fallback).
 */
export function commitBiomeOwnerIntent(params: CoopBiomeOwnerCommitParams): void {
  if (!isCoopBiomeOperationEnabled()) {
    return;
  }
  try {
    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const intent: CoopPendingOperation = {
      id: makeCoopOperationId(epoch, ownerSeat, params.seq),
      kind: params.kind,
      owner: ownerSeat,
      status: "proposed",
      payload: params.payload,
    };
    // The AUTHORITY (coop host) is the sole committer (invariant 3). When the LOCAL owner is the host, it
    // commits its own intent here; when the owner is the guest, the host commits on adopt (watcher seam).
    if (params.localRole === "host") {
      const res = host().submit(intent, controlContext(params.wave, params.turn), ownerParityValidator(params.pinned));
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed op with the durability journal so
        // a resend / reconnect tail can replay it. Rides ALONGSIDE the legacy relay (dual-run); no-op when
        // durability is OFF. The DATA still travels on the existing checkpoint (§1.2).
        journalCoopCommittedEnvelope(res.envelope);
        coopLog(
          "reward",
          `biome op OWNER commit kind=${params.kind} rev=${res.envelope.revision} id=${intent.id} (Wave-2a)`,
        );
      } else {
        coopWarn(
          "reward",
          `biome op OWNER commit non-committed (${res.kind}) id=${intent.id} - legacy relay carries it (Wave-2a)`,
        );
      }
    }
    // NOTE: the owner does NOT advance lastAppliedPinned - that is a WATCHER-only order (see its field
    // doc). The owner knows its own pick; only an adopted RELAY needs the stale-ordering guard.
  } catch (e) {
    coopWarn("reward", "biome op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2a)", e);
  }
}

// -----------------------------------------------------------------------------
// Watcher seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopBiomeWatcherAdoptParams {
  readonly kind: CoopBiomeOperationKind;
  readonly seq: number;
  readonly pinned: number;
  /** The awaited relay result (null = owner timed out / disconnected -> deterministic backstop). */
  readonly res: CoopBiomeRelayResult | null;
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}

/**
 * WATCHER: gate the adoption of the relayed owner pick through the operation primitive. When the flag is
 * OFF this is a pass-through (adopt iff the relay landed) - pure legacy behavior. When ON:
 *   - on the AUTHORITY watching a guest-owned pick, VALIDATE + COMMIT the guest's intent (invariant 3);
 *   - gate application idempotently by operationId + the pinned order (invariants 5, 6): a stale pick from
 *     an earlier interaction, a duplicate re-delivery, or a cross-epoch leftover is REJECTED, never applied
 *     (the #861 shape). The caller falls back to the deterministic backstop on a reject.
 * Never throws (a throw would fall to the legacy fallback via `adopt:false`).
 */
export function adoptBiomeWatcherChoice(params: CoopBiomeWatcherAdoptParams): CoopBiomeAdoptDecision {
  // Legacy / fallback: adopt iff the relay landed, no operation gating.
  if (!isCoopBiomeOperationEnabled()) {
    return params.res == null
      ? { adopt: false, reason: "no-relay" }
      : { adopt: true, choice: params.res.choice, data: params.res.data };
  }
  if (params.res == null) {
    return { adopt: false, reason: "no-relay" };
  }
  try {
    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const opId = makeCoopOperationId(epoch, ownerSeat, params.seq);
    const payload: CoopBiomePickPayload | CoopCrossroadsPickPayload =
      params.kind === "BIOME_PICK"
        ? { biomeId: params.res.data?.[0] ?? -1, nodeIndex: params.res.choice }
        : { optionIndex: params.res.choice };
    const intent: CoopPendingOperation = { id: opId, kind: params.kind, owner: ownerSeat, status: "proposed", payload };

    // The AUTHORITY (host) is the sole committer: if it is WATCHING a guest-owned pick, commit it now
    // (invariant 3). A rejection (wrong owner) -> do not adopt.
    if (params.localRole === "host") {
      const res = host().submit(intent, controlContext(params.wave, params.turn), ownerParityValidator(params.pinned));
      if (res.kind === "rejected" || res.kind === "rejected-late") {
        coopWarn("reward", `biome op WATCHER(host) commit REJECTED (${res.kind}) id=${opId} -> fallback (Wave-2a)`);
        return { adopt: false, reason: `host-${res.kind}` };
      }
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e): the host is the sole committer of a GUEST-owned pick; journal the
        // authoritative envelope it just produced so a cut is healed by the journal, not a bespoke self-heal.
        journalCoopCommittedEnvelope(res.envelope);
      }
    }

    // Stale / duplicate rejection (invariant 6, the #861 shape): a pick pinned STRICTLY BELOW one we already
    // adopted (a leftover from an earlier interaction), or a re-delivery of an already-applied op (same
    // operationId), can NEVER overwrite the live decision. The pinned counter is monotonic across all
    // interactions, so a legitimate current pick is always >= the last adopted one.
    if (params.pinned < lastAppliedPinned) {
      coopWarn(
        "reward",
        `biome op WATCHER REJECT stale/dup id=${opId} pinned=${params.pinned} lastApplied=${lastAppliedPinned} (Wave-2a)`,
      );
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    // ONE LEDGER + safe-boundary materialization: the journal may have consumed the operation before this
    // real phase resumed. Its live sink fed the authoritative choice into the local relay and armed this
    // marker. Consume the marker exactly once and let the existing phase apply that host-stated choice;
    // an ordinary relay duplicate (no marker) remains a no-op as before.
    if (guest().hasApplied(opId)) {
      if (!pendingJournalMaterializations.delete(opId)) {
        coopWarn(
          "reward",
          `biome op WATCHER REJECT duplicate id=${opId} pinned=${params.pinned} lastApplied=${lastAppliedPinned} (Wave-2a)`,
        );
        return { adopt: false, reason: "stale-or-duplicate" };
      }
      lastAppliedPinned = params.pinned;
      coopLog("reward", `biome op WATCHER materialize JOURNAL choice kind=${params.kind} id=${opId}`);
      return { adopt: true, choice: params.res.choice, data: params.res.data };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op).
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    const g = guest();
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn,
      logicalPhase: "BIOME_SELECT",
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.wave, params.turn).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("reward", `biome op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> fallback (Wave-2a)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }
    lastAppliedPinned = params.pinned;
    coopLog("reward", `biome op WATCHER adopt kind=${params.kind} choice=${params.res.choice} id=${opId} (Wave-2a)`);
    return { adopt: true, choice: params.res.choice, data: params.res.data };
  } catch (e) {
    coopWarn("reward", "biome op WATCHER gate threw (handled - deterministic fallback) (Wave-2a)", e);
    return { adopt: false, reason: "threw" };
  }
}

// -----------------------------------------------------------------------------
// Journal replay seam (Wave-2e, §4.2/§4.4): route a resent / reconnect-tail committed envelope INTO the
// idempotent guest applier - NOT around it - so a cut op re-applies exactly once by operationId.
// -----------------------------------------------------------------------------

/**
 * Apply a committed biome-travel envelope delivered by the durability journal (a resend or reconnect
 * tail). Routes into the SAME {@linkcode CoopOperationGuest} the live relay-adopt path uses, so it is
 * idempotent by operationId (invariant 5): a dual-run duplicate (the live relay already adopted it) is a
 * no-op. Returns true iff the op was NEWLY applied. No-op when the surface flag is OFF (pure legacy).
 */
function applyJournaledBiomeEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  // A consistent peer cannot send this while the surface is disabled. Refuse an incompatible/corrupt
  // frame without ACKing rather than permanently discarding an authoritative mutation.
  if (!isCoopBiomeOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op == null || op.status !== "applied") {
    return "rejected";
  }
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate"; // already converged via the journal (a reconnect resend re-delivery) - ACK, no re-apply.
  }
  if (!routeCoopOperationToLiveSink("op:biome", envelope)) {
    return "rejected";
  }
  // Re-key to the guest-local dense revision so the live relay and journal carriers share ONE applier
  // without creating artificial gaps when either carrier wins the race.
  const res = g.applyEnvelope({
    ...envelope,
    sessionEpoch: epoch,
    revision: g.getLastAppliedRevision() + 1,
  });
  if (res.kind !== "applied") {
    // A transient non-applicable result (a gap the manager already guards against, or a fail-closed):
    // leave it retriable (do NOT ACK). Never a permanent condition (a permanent one is a duplicate above).
    return "rejected";
  }
  // Route the newly-consumed op into the production live sink. It feeds the committed choice into the
  // receiver's local interaction relay, so the existing SelectBiomePhase / ErCrossroadsPhase safe apply path
  // performs the real mutation. That production sink arms the one-shot phase handoff itself; headless
  // recording sinks can still prove routing without changing live adoption semantics.
  coopLog("reward", `biome op JOURNAL apply id=${op.id} rev=${envelope.revision} (Wave-2e/W2e-R)`);
  return "applied";
}

// Register the biome-travel guest applier so the durability manager can route a resent / reconnect-tail
// `op:biome` envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:biome", applyJournaledBiomeEnvelope);

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op REWARD-SHOP + biome-MARKET operation surface (Wave-2d authoritative run-state
// migration; see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §2.5
// item 3 + §5.1). SURFACE 3 - the highest-traffic interaction (where #861 lived).
//
// This migrates the owner-alternated REWARD shop (SelectModifierPhase, #1 reward/shop/
// skip/reroll/check/transfer/lock) AND its sibling biome MARKET (BiomeShopPhase +
// Exotic/BlackMarket/ImportBazaar subclasses, #5) onto the authoritative operation model
// (coop-operation-runtime.ts). It is the Wave-2a biome adapter (coop-biome-operation.ts)
// cloned structurally, with the design deltas the multi-action nature of a shop forces.
//
// WHAT IT DOES (control plane only - the DATA plane is untouched, §1.2):
//   - OWNER: every relayed reward/market action mints a TYPED intent (invariant 2) and, on
//     the AUTHORITY (coop host), COMMITS it EXACTLY ONCE through CoopOperationHost
//     (invariant 3), advancing a surface-local revision (§1.5).
//   - WATCHER: gates its adoption of each relayed action through CoopOperationGuest -
//     idempotent by operationId (invariant 5), and REJECTS a stale/late choice (invariant 6,
//     the #861 shape) via the interaction-start watermarks below.
//
// DESIGN DELTAS vs Wave-2a (multi-action stream; recorded in §8.2 for later surfaces):
//   - MULTI-ACTION STREAM. Biome travel relays ONE pick per pinned interaction; a shop relays
//     a STREAM (buy, buy, lock, reroll, ... leave) on the SAME pinned counter. So each action is
//     ONE operation, and the operationId cannot be the raw pin alone (that would dedupe every
//     action after the first). We suffix the pin with a per-interaction monotonic ACTION ORDINAL
//     (`pin * ACTION_STRIDE + ordinal`) so each action is a distinct op, tracked SEPARATELY for
//     the owner (commit) and the watcher (adopt) so they never contaminate in the single-process
//     duo harness (§8.2 pitfall).
//   - TWO WATERMARKS for stale/late rejection (the biome adapter's single `lastAppliedPinned`
//     generalized for a stream). `lastAdoptedStart` rejects a pick from a STRICTLY EARLIER
//     interaction (`pin < lastAdoptedStart`, the #861 cross-interaction leftover). `lastLeftStart`
//     rejects a pick for an interaction the watcher already LEFT (`pin <= lastLeftStart`, the
//     late-choice-after-leave shape). Within a live interaction (`pin > both`) every action passes.
//   - CONTINUATION IDENTITY (#866). A move-learn continuation copy (BiomeShopPhase.copy / the base
//     SelectModifierPhase copy) inherits the pinned interaction counter, so its actions continue the
//     SAME operationId space + the SAME watermark tier - the operation identity survives the copy
//     rather than orphaning on a raw counter pin (which was exactly the #866 unpinned-orphan class).
//
// SUB-PICKER MODEL (party target / TM / ability / fusion): a nested sub-pick is folded into the
// single terminal action's payload `data` (a multi-step op payload, §8.2), NOT a separate
// sub-operation - the reward shop already collapses the party-target menu into the ONE relay this
// operation carries (coopFlushPending([slot, option])). Separate sub-SURFACES that fire their own
// relay channels (the ability-capsule phase #4, learn-move-forward #11) are migrated in later waves.
//
// DUAL-RUN (§1.8, §5.1): rides ALONGSIDE the legacy reward/biomeShop relay + the interaction counter,
// which the phases keep firing unchanged (removing them is FORBIDDEN until every surface is migrated).
// This layer is ADDITIVE control-plane bookkeeping + a watcher adoption GATE. When the flag is OFF the
// surface behaves EXACTLY as before (pure legacy pass-through).
//
// FLAG (§5.4): `isCoopRewardOperationEnabled()`. Default ON, version-gated by the existing
// COOP_PROTOCOL_VERSION (er-coop-13; NO new wire arms this wave - the control fields ride the existing
// relay carrier, the Wave-2a "carrier" delta). `COOP_REWARD_OP=off` forces legacy for CI/soak/rollback.
// State is per-session and reset on session boundaries (assembleCoopRuntime / clearCoopRuntime).
// =============================================================================

import { COOP_CAP_OP_REWARD, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import { COOP_INTERACTION_LEAVE, COOP_INTERACTION_REROLL } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopRewardActionPayload,
  type CoopShopBuyPayload,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  isCoopOperationJournalActive,
  registerCoopOperationApplier,
  tryJournalCoopCommittedEnvelope,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  type CoopCommitContext,
  type CoopIntentValidator,
  CoopOperationGuest,
  CoopOperationHost,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1, CoopRole } from "#data/elite-redux/coop/coop-transport";

/** The two shop surfaces this adapter serves: the reward screen (#1) and the biome market (#5). */
export type CoopShopSurface = "reward" | "market";

/** The awaited relay action the watcher gates (a subset of CoopInteractionChoice - choice/data). */
export interface CoopRewardRelayAction {
  /** Exact validated legacy action kind; becomes the authoritative REWARD payload label. */
  readonly label?: string | undefined;
  readonly choice: number;
  readonly data?: number[] | undefined;
  /** Present only when the durability live sink supplied this action. */
  readonly operationId?: string | undefined;
}

/** The watcher's adoption verdict for a relayed reward/market action. */
export type CoopRewardAdoptDecision =
  /** Adopt this action (apply it against the identical pool exactly as the legacy path would). */
  | { readonly adopt: true }
  /** Do NOT adopt (stale / late / duplicate / rejected / fail-closed): IGNORE it, keep awaiting the terminal. */
  | { readonly adopt: false; readonly reason: string };

// -----------------------------------------------------------------------------
// Flag + per-session state (reset on session boundaries).
// -----------------------------------------------------------------------------

/**
 * Default ON. Activation is HARD-GATED by the #806 protocol-version handshake (COOP_PROTOCOL_VERSION,
 * er-coop-13): a mixed-build pair refuses to pair / banners, so a live session has both peers on the
 * envelope build. The legacy path stays selectable (rollback = set false). CI/soak force legacy via
 * the COOP_REWARD_OP=off env override.
 */
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_REWARD_OP === "off");

let enabled = DEFAULT_ENABLED;

/**
 * The session epoch (§1.4). Wave-2d keeps it constant (1) per session and resets the surface state on
 * session boundaries; the full launch/resume epoch mint is a later, cross-surface piece (§2.4). An epoch
 * change still bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
 */
let epoch = 1;

/** The authority (coop host) commit log for shop ops. Lazily created; null until first use / on a non-host. */
let authorityHost: CoopOperationHost | null = null;

/** The watcher applier that gates adoption of a relayed action. Lazily created; null until first use. */
let watchGuest: CoopOperationGuest | null = null;

/** Pinned streams for which the journal became the live carrier; raw legacy echoes no longer mutate them. */
const journalLeadingStarts = new Set<number>();

/** Journal-consumed operations waiting for their safe phase-loop materialization. */
const pendingJournalMaterializations = new Set<string>();

/**
 * The highest pinned interaction start the local client has ADOPTED any action at AS A WATCHER. A pick
 * pinned STRICTLY BELOW it is a leftover from a strictly-earlier interaction a later one superseded (the
 * #861 cross-interaction stale shape). Advanced ONLY on a watcher adoption. -1 = none yet.
 */
interface RewardWatcherState {
  ordinal: number;
  ordinalStart: number;
  lastAdoptedStart: number;
  lastLeftStart: number;
}

function freshWatcherState(): RewardWatcherState {
  return { ordinal: 0, ordinalStart: -1, lastAdoptedStart: -1, lastLeftStart: -1 };
}

/** Per-peer state. Dual-engine tests share one JS realm; real peers do not share these cursors either. */
const watcherStateByRole: Record<CoopRole, RewardWatcherState> = {
  host: freshWatcherState(),
  guest: freshWatcherState(),
};

/** ACTION ORDINAL stride: pin * STRIDE + ordinal must not overflow into the next pin's op-id space. */
export const COOP_REWARD_ACTION_STRIDE = 100_000;

/** Arm one journal-led action before its production sink feeds the real reward/market FIFO. */
export function armCoopRewardJournalMaterialization(operationId: string, pinned: number): void {
  journalLeadingStarts.add(pinned);
  pendingJournalMaterializations.add(operationId);
}

/** The owner's per-interaction monotonic action ordinal (for the committed op-id). Reset when the pin changes. */
let ownerOrdinal = 0;
let ownerOrdinalStart = -1;
/** Exact once-only identity retained when a terminal must be retried after commit/journal failure. */
const ownerTerminalOperations = new Map<string, { readonly ordinal: number; readonly operationId: string }>();

/** The watcher's per-interaction monotonic action ordinal (for the applied op-id). Reset when the pin changes. */

/**
 * The surface-local revision FLOOR (W2e-R P0-3): seeded from the persisted per-class high-water on a COLD
 * resume so the producer continues at floor+1 (matching the restored durability receiver), keeping the
 * committed-op revision stream monotonic across the save boundary. See the biome adapter for the rationale.
 * 0 = fresh session. The reward screen + biome market share ONE host (§8.2.1), so ONE floor serves both.
 */
let revisionFloor = 0;

/**
 * True iff the migrated (envelope-gated) shop path is active; else pure legacy fallback (§5.1). The local
 * rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one (#896
 * W2e-R2): if the peer did not advertise "opSurface.reward", it is not in the intersection and the surface
 * stays OFF on BOTH peers (fail closed). Pre-handshake the capability gate is inert (local flag alone).
 */
export function isCoopRewardOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_REWARD);
}

/** Select the migrated path (true) or the legacy relay fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopRewardOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopRewardOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current shop operation epoch (§1.4). */
export function getCoopRewardOperationEpoch(): number {
  return epoch;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopRewardOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopRewardOperationState();
}

/** Tear down all per-session operation state (called from assembleCoopRuntime / clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopRewardOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  authorityHost = null;
  watchGuest = null;
  journalLeadingStarts.clear();
  pendingJournalMaterializations.clear();
  watcherStateByRole.host = freshWatcherState();
  watcherStateByRole.guest = freshWatcherState();
  ownerOrdinal = 0;
  ownerOrdinalStart = -1;
  ownerTerminalOperations.clear();
  revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:reward"]`. Recreates the
 * host + guests so the producer continues at floor+1 and the guests accept it. No-op for a fresh session.
 */
export function setCoopRewardOperationRevisionFloor(hw: number): void {
  if (!Number.isFinite(hw) || hw <= 0 || hw === revisionFloor) {
    return;
  }
  revisionFloor = hw;
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

/** The operation kind for a surface (the §2 successor of the reward / biomeShop relay kinds). */
function kindFor(surface: CoopShopSurface): Extract<CoopOperationKind, "REWARD" | "SHOP_BUY"> {
  return surface === "reward" ? "REWARD" : "SHOP_BUY";
}

/** Recover the validated relay kind from its canonical action encoding when the phase passed the compact shape. */
function relayedLabel(surface: CoopShopSurface, action: CoopRewardRelayAction): string {
  if (action.label != null) {
    return action.label;
  }
  if (surface === "market") {
    return "biomeShop";
  }
  if (action.choice === COOP_INTERACTION_LEAVE) {
    return "skip";
  }
  if (action.choice === COOP_INTERACTION_REROLL) {
    return "reroll";
  }
  return ["reward", "shop", "transfer", "lock", "check"][action.data?.[0] ?? -1] ?? "relay";
}

/**
 * The owner-parity validator (§1.3): the intent's owner seat MUST be the seat the interaction counter
 * assigns for this pinned slot. The typed successor of `isLocalOwnerAtCounter` - the host refuses an intent
 * from the wrong seat instead of trusting the sender.
 */
function ownerParityValidator(pinned: number): CoopIntentValidator {
  const expectedSeat = coopInteractionOwnerSeat(pinned);
  return intent =>
    intent.owner === expectedSeat
      ? { ok: true }
      : { ok: false, reason: `wrong-owner:${intent.owner}!=${expectedSeat}` };
}

/**
 * A minimal control-plane commit context. The shop decision carries no NEW data-plane payload over the wire
 * (the mon/field/money state travels on the existing checkpoint / waveEndState, dual-run), so the embedded
 * authoritativeState is a lightweight placeholder the applier never reads (it classifies on the CONTROL
 * fields only). The real adopt-by-id state apply is UNCHANGED (§1.2).
 */
function controlContext(surface: CoopShopSurface, wave: number, turn: number): CoopCommitContext {
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
  return { wave, turn, logicalPhase: surface === "reward" ? "REWARD_SELECT" : "SHOP", authoritativeState: placeholder };
}

/** Next per-interaction owner action ordinal for `pinned` (resets when the pinned interaction changes). */
function nextOwnerOrdinal(pinned: number): number {
  if (ownerOrdinalStart !== pinned) {
    ownerOrdinal = 0;
    ownerOrdinalStart = pinned;
  }
  return ownerOrdinal++;
}

/** Peek the watcher's current per-interaction action ordinal for `pinned` (resets when the pin changes). */
function watcherState(role: CoopRole, pinned: number): RewardWatcherState {
  const state = watcherStateByRole[role];
  if (state.ordinalStart !== pinned) {
    state.ordinal = 0;
    state.ordinalStart = pinned;
  }
  return state;
}

// -----------------------------------------------------------------------------
// Owner seam (§1.3 propose -> commit). Dual-run: the phase still fires the legacy relay.
// -----------------------------------------------------------------------------

export interface CoopRewardOwnerCommitParams {
  readonly surface: CoopShopSurface;
  /** The pinned interaction counter this shop opened on (coopInteractionStart / coopBiomeStart). */
  readonly pinned: number;
  /** The relayed action's wire label (reward/shop/skip/reroll/check/transfer/lock, or biomeShop). */
  readonly label: string;
  /** The picked option/cursor index, or a sentinel (COOP_INTERACTION_LEAVE / _REROLL). */
  readonly choice: number;
  /** The relayed data array (act-code + any resolved sub-pick), verbatim; undefined when none. */
  readonly data: number[] | undefined;
  /** True iff this action LEAVES the interaction for good (skip / leave / market terminal). */
  readonly terminal: boolean;
  /** The local client's coop role - determines whether it is the authority that COMMITS. */
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn?: number;
}

export interface CoopRewardOwnerCommitResult {
  readonly operationId: string;
  readonly revision: number;
}

/**
 * OWNER: mint + (on the authority) COMMIT one typed reward/market action through the operation primitive
 * (§1.3). ADDITIVE + dual-run: the phase still fires the legacy relay send; this records the authoritative
 * operation. No-op when the flag is OFF. Never throws (the legacy relay is the fallback).
 */
export function commitRewardOwnerIntent(params: CoopRewardOwnerCommitParams): CoopRewardOwnerCommitResult | null {
  if (!isCoopRewardOperationEnabled() || params.pinned < 0) {
    return null;
  }
  try {
    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const terminalKey = `${params.surface}:${params.pinned}`;
    const retainedTerminal = params.terminal ? ownerTerminalOperations.get(terminalKey) : undefined;
    const ordinal = retainedTerminal?.ordinal ?? nextOwnerOrdinal(params.pinned);
    const opId =
      retainedTerminal?.operationId
      ?? makeCoopOperationId(
        epoch,
        ownerSeat,
        params.pinned * COOP_REWARD_ACTION_STRIDE + ordinal,
        kindFor(params.surface),
      );
    if (params.terminal && retainedTerminal == null) {
      ownerTerminalOperations.set(terminalKey, { ordinal, operationId: opId });
    }
    const payload = buildPayload(params.surface, params.label, params.choice, params.data, params.terminal);
    const intent: CoopPendingOperation = {
      id: opId,
      kind: kindFor(params.surface),
      owner: ownerSeat,
      status: "proposed",
      payload,
    };
    // The AUTHORITY (coop host) is the sole committer (invariant 3). When the LOCAL owner is the host it
    // commits its own intent here; when the owner is the guest, the host commits on adopt (watcher seam).
    if (params.localRole === "host") {
      const res = host().submit(
        intent,
        controlContext(params.surface, params.wave, params.turn ?? 0),
        ownerParityValidator(params.pinned),
      );
      if (res.kind === "committed" || res.kind === "reack") {
        const canonicalPayload = res.kind === "reack" ? res.op.payload : res.envelope.pendingOperation?.payload;
        if (JSON.stringify(canonicalPayload) !== JSON.stringify(intent.payload)) {
          return null;
        }
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed action with the durability journal
        // (resend / reconnect replay). Rides ALONGSIDE the legacy relay (dual-run); no-op when durability OFF.
        if (!tryJournalCoopCommittedEnvelope(res.envelope)) {
          return null;
        }
        coopLog(
          "reward",
          `${params.surface} op OWNER commit label=${params.label} rev=${res.envelope.revision} id=${opId} (Wave-2d)`,
        );
        return { operationId: opId, revision: res.envelope.revision };
      }
      coopWarn(
        "reward",
        `${params.surface} op OWNER commit non-committed (${res.kind}) id=${opId} - legacy relay carries it (Wave-2d)`,
      );
      return null;
    }
    // NOTE: the owner does NOT advance the watcher watermarks - those are a WATCHER-only order (§8.2). The
    // owner knows its own picks; only an adopted RELAY needs the stale-ordering guard.
    return { operationId: opId, revision: 0 };
  } catch (e) {
    coopWarn("reward", `${params.surface} op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2d)`, e);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Watcher seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopRewardWatcherAdoptParams {
  readonly surface: CoopShopSurface;
  readonly pinned: number;
  /** The awaited relay action (null = owner timed out / disconnected). */
  readonly action: CoopRewardRelayAction | null;
  /** True iff this action LEAVES the interaction for good (skip / leave / market terminal). */
  readonly terminal: boolean;
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn?: number;
}

/**
 * WATCHER: gate the adoption of one relayed owner action through the operation primitive. When the flag is
 * OFF this is a pass-through (adopt iff the action landed) - pure legacy behavior. When ON:
 *   - on the AUTHORITY watching a guest-owned action, VALIDATE + COMMIT the guest's intent (invariant 3);
 *   - REJECT a stale pick from a strictly-earlier interaction (`pin < lastAdoptedStart`, #861) or a late
 *     pick for an interaction already LEFT (`pin <= lastLeftStart`), and de-dupe an exact re-delivery by
 *     operationId (invariants 5, 6). On a reject the CALLER ignores the action and keeps awaiting the
 *     authoritative terminal (exactly like the existing #854 out-of-range guard).
 * Never throws (a throw returns `adopt:false` -> the caller skips the action, never crashing the watcher).
 */
export function adoptRewardWatcherChoice(params: CoopRewardWatcherAdoptParams): CoopRewardAdoptDecision {
  // Legacy / fallback: adopt iff the action landed, no operation gating.
  if (!isCoopRewardOperationEnabled()) {
    return params.action == null ? { adopt: false, reason: "no-relay" } : { adopt: true };
  }
  if (params.action == null) {
    return { adopt: false, reason: "no-relay" };
  }
  if (params.pinned < 0) {
    // Unpinned interaction (should not happen in a live run): fall through to the legacy apply.
    return { adopt: true };
  }
  try {
    const state = watcherState(params.localRole, params.pinned);
    // Stale / late rejection (invariant 6, the #861 shape). The pinned interaction counter is monotonic, so:
    //  - a pick STRICTLY BELOW the highest interaction we have adopted at is a leftover from an interaction a
    //    later one already superseded (the cross-interaction stale buffer);
    //  - a pick AT OR BELOW the highest interaction we have LEFT is a late choice for an interaction we
    //    already terminated (the late-after-leave shape).
    // Within a live interaction (pin > both) every action passes, so a legitimate stream of buys is adopted.
    if (params.pinned < state.lastAdoptedStart || params.pinned <= state.lastLeftStart) {
      coopWarn(
        "reward",
        `${params.surface} op WATCHER REJECT stale/late pin=${params.pinned} adoptedStart=${state.lastAdoptedStart} leftStart=${state.lastLeftStart} role=${params.localRole} (Wave-2d)`,
      );
      return { adopt: false, reason: "stale-or-late" };
    }

    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const ordinal = state.ordinal;
    const opId = makeCoopOperationId(
      epoch,
      ownerSeat,
      params.pinned * COOP_REWARD_ACTION_STRIDE + ordinal,
      kindFor(params.surface),
    );
    const payload = buildPayload(
      params.surface,
      relayedLabel(params.surface, params.action),
      params.action.choice,
      params.action.data,
      params.terminal,
    );
    const intent: CoopPendingOperation = {
      id: opId,
      kind: kindFor(params.surface),
      owner: ownerSeat,
      status: "proposed",
      payload,
    };

    // The AUTHORITY (host) is the sole committer: if it is WATCHING a guest-owned action, commit it now
    // (invariant 3). A rejection (wrong owner) -> do not adopt.
    if (params.localRole === "host") {
      const res = host().submit(
        intent,
        controlContext(params.surface, params.wave, params.turn ?? 0),
        ownerParityValidator(params.pinned),
      );
      if (res.kind === "rejected" || res.kind === "rejected-late") {
        coopWarn("reward", `${params.surface} op WATCHER(host) commit REJECTED (${res.kind}) id=${opId} (Wave-2d)`);
        return { adopt: false, reason: `host-${res.kind}` };
      }
      if (res.kind === "committed" || res.kind === "reack") {
        const canonicalPayload = res.kind === "reack" ? res.op.payload : res.envelope.pendingOperation?.payload;
        if (JSON.stringify(canonicalPayload) !== JSON.stringify(intent.payload)) {
          return { adopt: false, reason: "host-reack-payload-conflict" };
        }
        // COMMIT -> JOURNAL (Wave-2e): the host is the sole committer of a GUEST-owned action; journal the
        // authoritative envelope so a cut is healed by the journal, not a bespoke self-heal.
        if (!tryJournalCoopCommittedEnvelope(res.envelope)) {
          return { adopt: false, reason: "host-journal-not-retained" };
        }
        // The authoritative host applies its validated guest-owned action at this safe phase seam.
        // The remote guest remains envelope-gated and merely ACKs/dedupes its already-proposed action.
        state.ordinal += 1;
        state.lastAdoptedStart = Math.max(state.lastAdoptedStart, params.pinned);
        if (params.terminal) {
          state.lastLeftStart = Math.max(state.lastLeftStart, params.pinned);
        }
        return { adopt: true };
      }
      return { adopt: false, reason: "host-duplicate" };
    }

    // Once the durability journal wins one action in this pinned FIFO, it leads the remainder of the
    // interaction. Ignore raw legacy echoes (or raw later actions that raced ahead) and await their tagged
    // committed envelope. This prevents a reordered echo from being mistaken for the next ordinal.
    if (journalLeadingStarts.has(params.pinned) && params.action.operationId !== opId) {
      return { adopt: false, reason: "await-journal" };
    }

    // The journal consumes the ONE shared ledger before the safe phase loop resumes. A tagged durable action
    // with the matching one-shot marker is therefore legitimate materialization, not a duplicate.
    if (guest().hasApplied(opId)) {
      if (params.action.operationId === opId && pendingJournalMaterializations.delete(opId)) {
        state.ordinal += 1;
        state.lastAdoptedStart = Math.max(state.lastAdoptedStart, params.pinned);
        if (params.terminal) {
          state.lastLeftStart = Math.max(state.lastLeftStart, params.pinned);
        }
        coopLog(
          "reward",
          `${params.surface} op WATCHER materialize JOURNAL choice=${params.action.choice} terminal=${params.terminal} id=${opId}`,
        );
        return { adopt: true };
      }
      coopWarn("reward", `${params.surface} op WATCHER REJECT duplicate id=${opId} (Wave-2d)`);
      return { adopt: false, reason: "duplicate" };
    }

    if (isCoopOperationJournalActive()) {
      return { adopt: false, reason: "await-authoritative-envelope" };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op).
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    const g = guest();
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn ?? 0,
      logicalPhase: params.surface === "reward" ? "REWARD_SELECT" : "SHOP",
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.surface, params.wave, params.turn ?? 0).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("reward", `${params.surface} op WATCHER guest non-applied (${applyRes.kind}) id=${opId} (Wave-2d)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }

    // Advance the watcher order + ordinal ONLY on a successful adoption (§8.2: never on the owner's commit).
    state.ordinal += 1;
    state.lastAdoptedStart = Math.max(state.lastAdoptedStart, params.pinned);
    if (params.terminal) {
      state.lastLeftStart = Math.max(state.lastLeftStart, params.pinned);
    }
    coopLog(
      "reward",
      `${params.surface} op WATCHER adopt choice=${params.action.choice} terminal=${params.terminal} id=${opId} (Wave-2d)`,
    );
    return { adopt: true };
  } catch (e) {
    coopWarn("reward", `${params.surface} op WATCHER gate threw (handled - legacy apply is the fallback) (Wave-2d)`, e);
    return { adopt: true };
  }
}

// -----------------------------------------------------------------------------
// Journal replay seam (Wave-2e, §4.2/§4.4): route a resent / reconnect-tail committed envelope INTO the
// idempotent guest applier - NOT around it - so a cut action re-applies exactly once by operationId.
// -----------------------------------------------------------------------------

/**
 * Apply a committed reward/market action envelope delivered by the durability journal (resend or reconnect
 * tail). Routes into the SAME {@linkcode CoopOperationGuest} the live relay-adopt path uses, so it is
 * idempotent by operationId (invariant 5): a dual-run duplicate (the live relay already adopted it) is a
 * no-op. Returns true iff the action was NEWLY applied. No-op when the surface flag is OFF (pure legacy).
 * Both the reward screen and the biome market ride this one class ("op:reward"), sharing one applier.
 */
function applyJournaledRewardEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopRewardOperationEnabled()) {
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
  if (applyCoopOperationEnvelope(g, "op:reward", envelope) !== "applied") {
    return "rejected"; // transient non-applicable (retriable); never a permanent condition (that is a duplicate above).
  }
  // Route the newly-consumed action into the production sink. It feeds the tagged committed choice into the
  // receiver's existing reward/market FIFO; the phase remains the sole safe mutation site.
  coopLog("reward", `shop op JOURNAL apply kind=${op.kind} id=${op.id} rev=${envelope.revision} (Wave-2e/W2e-R)`);
  return "applied";
}

// Register the shared reward/market guest applier so the durability manager can route a resent /
// reconnect-tail `op:reward` envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:reward", applyJournaledRewardEnvelope);

/** Build the typed per-kind payload for a surface (a REWARD action or a SHOP_BUY action). */
function buildPayload(
  surface: CoopShopSurface,
  label: string,
  choice: number,
  data: number[] | undefined,
  terminal: boolean,
): CoopRewardActionPayload | CoopShopBuyPayload {
  return surface === "reward"
    ? ({ label, choice, data, terminal } satisfies CoopRewardActionPayload)
    : ({ slot: choice, data, terminal } satisfies CoopShopBuyPayload);
}

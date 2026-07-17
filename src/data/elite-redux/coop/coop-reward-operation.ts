/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P33 authoritative REWARD-SHOP + biome-MARKET transaction surface.
//
// Every click is first retained as a typed, addressed intent. The host validates and executes that
// intent exactly once, captures the complete post-action battle state, and journals one immutable
// result envelope. A guest applies that state atomically before the existing phase loop receives a
// tagged action for presentation/continuation. Retries reassert the same state tick and operation id;
// they never rerun the purchase or reward mutation.
//
// A shop is a multi-action stream (buy, lock, reroll, ... leave), so operation identity combines the
// pinned interaction with a monotonic action ordinal. Separate role-scoped cursors preserve the same
// behavior in real peers and in the two-engine single-process harness. Raw relay messages remain only
// as compatibility/presentation carriers; once the journal leads a stream, an untagged raw echo cannot
// author state or advance its ordinal.
// =============================================================================

import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_CAP_OP_REWARD, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import { COOP_INTERACTION_LEAVE, COOP_INTERACTION_REROLL } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH,
  COOP_ME_REWARD_SURFACE_LIMIT,
  type CoopAuthoritativeEnvelopeV1,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopRewardActionPayload,
  type CoopShopBuyPayload,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  applyCoopOperationEnvelope,
  getActiveCoopOperationDurability,
  isCoopOperationJournalActive,
  isCoopOperationJournalActiveFor,
  registerCoopOperationApplier,
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
} from "#data/elite-redux/coop/coop-operation-runtime";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopRewardSurfaceIdentity,
  CoopRole,
} from "#data/elite-redux/coop/coop-transport";

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
  /** Ordered Mystery reward surface stated by the raw or durable carrier. */
  readonly rewardSurface?: CoopRewardSurfaceIdentity | undefined;
}

/** The watcher's adoption verdict for a relayed reward/market action. */
export type CoopRewardAdoptDecision =
  /**
   * Adopt this action. In retained-result mode `authoritativeProjection` means the complete host state
   * has already been applied; the phase may render/continue but must not execute the gameplay mutation.
   */
  | {
      readonly adopt: true;
      readonly operationId?: string;
      readonly authoritativeProjection?: boolean;
      readonly requiresAuthorityCommit?: boolean;
    }
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
 * Engine state seam. Production uses the normal atomic battle-state transaction. A focused operation test
 * can replace it with a plain-state model without importing a second Phaser scene into the same process.
 */
export interface CoopRewardAuthorityStateHooks {
  readonly capture: (turn: number) => CoopAuthoritativeBattleStateV1 | null;
  readonly apply: (state: CoopAuthoritativeBattleStateV1) => boolean;
  readonly reapply: (state: CoopAuthoritativeBattleStateV1) => boolean;
}

const productionAuthorityStateHooks: CoopRewardAuthorityStateHooks = {
  capture: turn => captureCoopAuthoritativeBattleState(turn),
  apply: state => applyCoopAuthoritativeBattleState(state, true),
  reapply: state => reapplyAcceptedCoopAuthoritativeBattleState(state, true),
};

let authorityStateHooks: CoopRewardAuthorityStateHooks = productionAuthorityStateHooks;

/** Focused-test seam; passing null restores the production atomic capture/apply implementation. */
export function setCoopRewardAuthorityStateHooksForTest(hooks: CoopRewardAuthorityStateHooks | null): void {
  authorityStateHooks = hooks ?? productionAuthorityStateHooks;
}

/**
 * The highest pinned interaction start the local client has ADOPTED any action at AS A WATCHER. A pick
 * pinned STRICTLY BELOW it is a leftover from a strictly-earlier interaction a later one superseded (the
 * #861 cross-interaction stale shape). Advanced ONLY on a watcher adoption. -1 = none yet.
 */
interface RewardWatcherState {
  ordinal: number;
  ordinalStart: number;
  lastLeftStart: number;
}

function freshWatcherState(): RewardWatcherState {
  return { ordinal: 0, ordinalStart: -1, lastLeftStart: -1 };
}

/** Cross-stream ordering plus independent same-pin terminal fences for every ordered reward surface. */
interface RewardWatcherRoleState {
  /** Highest pin adopted on any reward/market stream. Rejects leftovers from superseded interactions. */
  lastAdoptedStart: number;
  /** Ordinal and terminal fence keyed by semantic stream; two P36 surfaces may legitimately share one pin. */
  readonly streams: Map<string, RewardWatcherState>;
}

function freshWatcherRoleState(): RewardWatcherRoleState {
  return { lastAdoptedStart: -1, streams: new Map<string, RewardWatcherState>() };
}

/** ACTION ORDINAL stride: pin * STRIDE + ordinal must not overflow into the next pin's op-id space. */
export const COOP_REWARD_ACTION_STRIDE = 100_000;

/** Disjoint action range for the ambient stream and each of the at most 16 P36 Mystery surfaces. */
export const COOP_REWARD_SURFACE_ACTION_STRIDE = 5_000;

/** Existing cursor mirror reserves six bits for rerolls; P36 adds a disjoint ordered-surface namespace. */
export const COOP_REWARD_MIRROR_REROLL_STRIDE = 64;
export const COOP_ME_REWARD_MIRROR_SEQ_BASE = 1_000_000_000;

function rewardSurfaceKey(rewardSurface?: CoopRewardSurfaceIdentity): string {
  return rewardSurface == null ? "ambient" : `${rewardSurface.ordinal}:${rewardSurface.surfaceId}`;
}

/** Canonical operation stream: durable operation class plus ordered reward-surface identity. */
function rewardOperationStreamKey(surface: CoopShopSurface, rewardSurface?: CoopRewardSurfaceIdentity): string {
  return `${kindFor(surface)}:${rewardSurfaceKey(rewardSurface)}`;
}

const COOP_REWARD_SURFACE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

export function isValidCoopRewardSurfaceIdentity(rewardSurface: unknown): rewardSurface is CoopRewardSurfaceIdentity {
  return (
    rewardSurface != null
    && typeof rewardSurface === "object"
    && !Array.isArray(rewardSurface)
    && Number.isSafeInteger((rewardSurface as CoopRewardSurfaceIdentity).ordinal)
    && (rewardSurface as CoopRewardSurfaceIdentity).ordinal >= 0
    && (rewardSurface as CoopRewardSurfaceIdentity).ordinal < COOP_ME_REWARD_SURFACE_LIMIT
    && typeof (rewardSurface as CoopRewardSurfaceIdentity).surfaceId === "string"
    && (rewardSurface as CoopRewardSurfaceIdentity).surfaceId.length <= COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH
    && COOP_REWARD_SURFACE_ID_PATTERN.test((rewardSurface as CoopRewardSurfaceIdentity).surfaceId)
  );
}

function rewardStreamKey(surface: CoopShopSurface, pinned: number, rewardSurface?: CoopRewardSurfaceIdentity): string {
  return `${pinned}:${rewardOperationStreamKey(surface, rewardSurface)}`;
}

/**
 * Encode the ordered surface ordinal into the existing numeric operation-id address. The full stable
 * surfaceId remains in the typed payload, so same-ordinal/different-id proposals conflict instead of aliasing.
 */
export function coopRewardOperationActionSlot(
  pinned: number,
  actionOrdinal: number,
  rewardSurface?: CoopRewardSurfaceIdentity,
): number | null {
  const surfaceOffset = rewardSurface == null ? 0 : (rewardSurface.ordinal + 1) * COOP_REWARD_SURFACE_ACTION_STRIDE;
  if (
    !Number.isSafeInteger(pinned)
    || pinned < 0
    || !Number.isSafeInteger(actionOrdinal)
    || actionOrdinal < 0
    || actionOrdinal >= COOP_REWARD_SURFACE_ACTION_STRIDE
    || (rewardSurface != null && !isValidCoopRewardSurfaceIdentity(rewardSurface))
    || !Number.isSafeInteger(surfaceOffset)
    || surfaceOffset < 0
    || surfaceOffset + actionOrdinal >= COOP_REWARD_ACTION_STRIDE
  ) {
    return null;
  }
  const slot = pinned * COOP_REWARD_ACTION_STRIDE + surfaceOffset + actionOrdinal;
  return Number.isSafeInteger(slot) ? slot : null;
}

/**
 * Stable cosmetic cursor address. Ambient rewards retain their historical formula; ordered Mystery
 * surfaces use a disjoint range so neither another surface at the same pin nor the next ambient pin can
 * replay buffered buttons into this screen.
 */
export function coopRewardMirrorSeq(
  pinned: number,
  reroll: number,
  rewardSurface?: CoopRewardSurfaceIdentity,
): number | null {
  if (
    !Number.isSafeInteger(pinned)
    || pinned < 0
    || !Number.isSafeInteger(reroll)
    || reroll < 0
    || (rewardSurface != null && !isValidCoopRewardSurfaceIdentity(rewardSurface))
  ) {
    return null;
  }
  const rerollSlot = Math.min(reroll, COOP_REWARD_MIRROR_REROLL_STRIDE - 1);
  if (rewardSurface == null) {
    const seq = pinned * COOP_REWARD_MIRROR_REROLL_STRIDE + rerollSlot;
    return Number.isSafeInteger(seq) ? seq : null;
  }
  const surfacePlanStride = COOP_ME_REWARD_SURFACE_LIMIT * COOP_REWARD_MIRROR_REROLL_STRIDE;
  const seq =
    COOP_ME_REWARD_MIRROR_SEQ_BASE
    + pinned * surfacePlanStride
    + rewardSurface.ordinal * COOP_REWARD_MIRROR_REROLL_STRIDE
    + rerollSlot;
  return Number.isSafeInteger(seq) ? seq : null;
}

/** Arm one journal-led action before its production sink feeds the real reward/market FIFO. */
export function armCoopRewardJournalMaterialization(operationId: string, pinned: number): void {
  const s = state();
  s.journalLeadingStarts.add(pinned);
  s.pendingJournalMaterializations.add(operationId);
}

interface PreparedRewardIntent {
  readonly intent: CoopPendingOperation;
  readonly surface: CoopShopSurface;
  readonly rewardSurface?: CoopRewardSurfaceIdentity | undefined;
  readonly pinned: number;
  readonly terminal: boolean;
  readonly wave: number;
  readonly turn: number;
  readonly localRole: CoopRole;
  readonly watcherRoleState?: RewardWatcherRoleState;
  readonly watcherState?: RewardWatcherState;
  executing: boolean;
  watcherAdvanced: boolean;
}

function preparedKey(role: CoopRole, operationId: string): string {
  return `${role}:${operationId}`;
}

/**
 * Per-runtime apply state for the reward-shop + biome-market surface (see coop-operation-runtime.ts opState
 * infra). Relocated off module-globals (bargain/stormglass pattern) so the single-process two-engine harness
 * gives each client its OWN reward cursors/tracking: a host self-apply no longer marks a SHARED cursor that
 * the guest then short-circuits as a duplicate (the reward-mirror desync). CRUCIAL for reward: its guest
 * watcher + owner two-phase commit run from `await` tails / Phaser callbacks, so phases capture a
 * {@linkcode CoopRewardOperationBinding} before scheduling and pass it back explicitly. They never mutate
 * the process-wide active selector to impersonate another runtime. In production (one runtime per process)
 * this is identical to the former globals. The reward screen + biome market share ONE record.
 */
interface RewardOpState {
  /**
   * The session epoch (§1.4). Wave-2d keeps it constant (1) per session and resets the surface state on
   * session boundaries; a change bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
   */
  epoch: number;
  /**
   * The surface-local revision FLOOR (W2e-R P0-3): seeded from the persisted per-class high-water on a COLD
   * resume so the producer continues at floor+1 (matching the restored durability receiver), keeping the
   * committed-op revision stream monotonic across the save boundary. 0 = fresh session. The reward screen +
   * biome market share ONE host (§8.2.1), so ONE floor serves both.
   */
  revisionFloor: number;
  /** The authority (coop host) commit log for shop ops. Lazily created; null until first use / on a non-host. */
  authorityHost: CoopOperationHost | null;
  /** The watcher applier that gates adoption of a relayed action. Lazily created; null until first use. */
  watchGuest: CoopOperationGuest | null;
  /** Pinned streams for which the journal became the live carrier; raw legacy echoes no longer mutate them. */
  readonly journalLeadingStarts: Set<number>;
  /** Journal-consumed operations waiting for their safe phase-loop materialization. */
  readonly pendingJournalMaterializations: Set<string>;
  /** Complete result state already installed on this receiver, but not necessarily materialized into its UI yet. */
  readonly stateAppliedOperations: Set<string>;
  /** Per-peer watcher state. Dual-engine tests share one JS realm; real peers do not share these cursors either. */
  readonly watcherStateByRole: Record<CoopRole, RewardWatcherRoleState>;
  /** Independent monotonic action ordinal for every canonical operation stream at an interaction pin. */
  readonly ownerOrdinalsByStream: Map<string, number>;
  /** Exact once-only identity retained when a terminal must be retried after commit/journal failure. */
  readonly ownerTerminalOperations: Map<string, { readonly ordinal: number; readonly operationId: string }>;
  /** Proposed peer intents retained separately per local role (the two-engine harness shares one realm). */
  readonly preparedIntents: Map<string, PreparedRewardIntent>;
  /** Exact immutable host results survive a journal failure/retry without recapturing a later state tick. */
  readonly committedResultEnvelopes: Map<string, CoopAuthoritativeEnvelopeV1>;
}

registerCoopOpSurfaceState(
  "reward",
  (): RewardOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    watchGuest: null,
    journalLeadingStarts: new Set<number>(),
    pendingJournalMaterializations: new Set<string>(),
    stateAppliedOperations: new Set<string>(),
    watcherStateByRole: { host: freshWatcherRoleState(), guest: freshWatcherRoleState() },
    ownerOrdinalsByStream: new Map(),
    ownerTerminalOperations: new Map(),
    preparedIntents: new Map(),
    committedResultEnvelopes: new Map(),
  }),
);

/**
 * FAIL-LOUD apply-path accessor: requires an installed runtime (a fresh runtime holds a reset record). The
 * caught `[coop-op]` throw is NEVER silently degraded to legacy fallback ({@linkcode isCoopOpRuntimeError}) -
 * a missing/wrong runtime at a reward continuation is a real defect that must self-identify, not hide behind
 * "expected false to be true".
 */
export interface CoopRewardOperationBinding {
  readonly opState: CoopRuntimeOpState;
  readonly durability: CoopDurabilityManager | null;
}

/** Capture the scheduling client's immutable runtime selectors before an async UI/phase boundary. */
export function captureCoopRewardOperationBinding(): CoopRewardOperationBinding | null {
  const opState = getActiveCoopRuntimeOpState();
  return opState == null ? null : { opState, durability: getActiveCoopOperationDurability() };
}

function state(binding?: CoopRewardOperationBinding | null): RewardOpState {
  return binding == null
    ? requireCoopOpSurfaceState<RewardOpState>("reward")
    : requireCoopOpSurfaceStateFor<RewardOpState>(binding.opState, "reward");
}

function journalActive(binding?: CoopRewardOperationBinding | null): boolean {
  return binding == null ? isCoopOperationJournalActive() : isCoopOperationJournalActiveFor(binding.durability);
}

function retainEnvelope(envelope: CoopAuthoritativeEnvelopeV1, binding?: CoopRewardOperationBinding | null): boolean {
  return binding == null
    ? tryJournalCoopCommittedEnvelope(envelope)
    : tryJournalCoopCommittedEnvelopeFor(binding.durability, envelope);
}

/**
 * True iff a caught error is the fail-loud "no runtime installed / no per-runtime record" from
 * {@linkcode requireCoopOpSurfaceState}. Such an error means a reward op ran outside its owning runtime's
 * context (a continuation that failed to carry its captured binding); it must PROPAGATE so it is
 * visible, never be swallowed into the legacy-relay fallback (that masking caused the #922 reward-mirror
 * regression to surface only as "expected false to be true").
 */
function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

/**
 * True iff the migrated (envelope-gated) shop path is active; else pure legacy fallback (§5.1). The local
 * rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one (#896
 * W2e-R2): if the peer did not advertise "opSurface.reward", it is not in the intersection and the surface
 * stays OFF on BOTH peers (fail closed). Pre-handshake the capability gate is inert (local flag alone).
 */
export function isCoopRewardOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_REWARD);
}

/** Live P33 result mode: choices are intents and only a retained complete host result may author state. */
export function isCoopRewardRetainedResultMode(binding?: CoopRewardOperationBinding | null): boolean {
  return isCoopRewardOperationEnabled() && journalActive(binding);
}

/** Select the migrated path (true) or the legacy relay fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopRewardOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopRewardOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current shop operation epoch (§1.4). Base epoch (1) when no runtime is installed. */
export function getCoopRewardOperationEpoch(): number {
  return maybeCoopOpSurfaceState<RewardOpState>("reward")?.epoch ?? 1;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch. Safe no-op when idle.
 */
export function setCoopRewardOperationEpoch(next: number): void {
  const s = maybeCoopOpSurfaceState<RewardOpState>("reward");
  if (s == null || next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopRewardOperationState();
}

/**
 * Tear down all per-session operation state (called from clearCoopRuntime + tests). Routes through the
 * ACTIVE runtime's own record so a teardown clears its OWN cursors/tracking, not a global. Keeps the flag.
 * Safe no-op when no runtime is installed (a fresh runtime's record is already reset).
 */
export function resetCoopRewardOperationState(): void {
  const s = maybeCoopOpSurfaceState<RewardOpState>("reward");
  if (s == null) {
    return; // safe no-op: no runtime installed, nothing exists to reset
  }
  resetActiveCoopRuntimeClocks();
  s.authorityHost = null;
  s.watchGuest = null;
  s.journalLeadingStarts.clear();
  s.pendingJournalMaterializations.clear();
  s.stateAppliedOperations.clear();
  s.preparedIntents.clear();
  s.committedResultEnvelopes.clear();
  s.watcherStateByRole.host = freshWatcherRoleState();
  s.watcherStateByRole.guest = freshWatcherRoleState();
  s.ownerOrdinalsByStream.clear();
  s.ownerTerminalOperations.clear();
  s.revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:reward"]`. Recreates the
 * host + guests so the producer continues at floor+1 and the guests accept it. No-op for a fresh session.
 */
export function setCoopRewardOperationRevisionFloor(hw: number): void {
  const s = maybeCoopOpSurfaceState<RewardOpState>("reward");
  if (s == null) {
    return;
  }
  if (!Number.isFinite(hw) || hw <= 0 || hw === s.revisionFloor) {
    return;
  }
  s.revisionFloor = hw;
  s.authorityHost = null;
  s.watchGuest = null;
}

// -----------------------------------------------------------------------------
// Internals.
// -----------------------------------------------------------------------------

function host(binding?: CoopRewardOperationBinding | null): CoopOperationHost {
  const s = state(binding);
  s.authorityHost ??=
    binding == null
      ? CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationHost.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(binding?: CoopRewardOperationBinding | null): CoopOperationGuest {
  const s = state(binding);
  s.watchGuest ??=
    binding == null
      ? CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor })
      : CoopOperationGuest.forRuntime(binding.opState, { epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.watchGuest;
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
function legacyControlContext(surface: CoopShopSurface, wave: number, turn: number): CoopCommitContext {
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

function authoritativeResultContext(
  surface: CoopShopSurface,
  wave: number,
  turn: number,
  authoritativeState: CoopAuthoritativeBattleStateV1,
): CoopCommitContext {
  return {
    wave,
    turn,
    logicalPhase: surface === "reward" ? "REWARD_SELECT" : "SHOP",
    authoritativeState,
  };
}

/** Reject the old empty control placeholder on every live retained result. */
function isCompleteRewardAuthorityState(
  state: CoopAuthoritativeBattleStateV1 | null | undefined,
  wave: number,
  turn: number,
): state is CoopAuthoritativeBattleStateV1 {
  return (
    state?.version === 1
    && Number.isSafeInteger(state.tick)
    && state.tick > 0
    && state.wave === wave
    && state.turn === turn
    && Array.isArray(state.playerParty)
    && state.playerParty.length > 0
    && Array.isArray(state.enemyParty)
    && Array.isArray(state.field)
    && Array.isArray(state.arenaTags)
    && Array.isArray(state.pokeballCounts)
    && Array.isArray(state.playerModifiers)
    && Array.isArray(state.enemyModifiers)
    && Number.isFinite(state.money)
  );
}

function samePayload(left: CoopPendingOperation["payload"], right: CoopPendingOperation["payload"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function retainPreparedIntent(s: RewardOpState, prepared: PreparedRewardIntent): boolean {
  const key = preparedKey(prepared.localRole, prepared.intent.id);
  const existing = s.preparedIntents.get(key);
  if (existing != null) {
    return (
      existing.surface === prepared.surface
      && rewardSurfaceKey(existing.rewardSurface) === rewardSurfaceKey(prepared.rewardSurface)
      && existing.pinned === prepared.pinned
      && existing.terminal === prepared.terminal
      && samePayload(existing.intent.payload, prepared.intent.payload)
    );
  }
  s.preparedIntents.set(key, prepared);
  return true;
}

/** Next owner action ordinal in the exact operation-class + reward-surface stream at `pinned`. */
function nextOwnerOrdinal(
  s: RewardOpState,
  pinned: number,
  surface: CoopShopSurface,
  rewardSurface?: CoopRewardSurfaceIdentity,
): number {
  const streamKey = rewardStreamKey(surface, pinned, rewardSurface);
  const ordinal = s.ownerOrdinalsByStream.get(streamKey) ?? 0;
  s.ownerOrdinalsByStream.set(streamKey, ordinal + 1);
  return ordinal;
}

/** Peek the watcher's current per-interaction action ordinal for `pinned` (resets when the pin changes). */
function watcherState(
  s: RewardOpState,
  role: CoopRole,
  surface: CoopShopSurface,
  pinned: number,
  rewardSurface?: CoopRewardSurfaceIdentity,
): { readonly roleState: RewardWatcherRoleState; readonly streamState: RewardWatcherState } {
  const roleState = s.watcherStateByRole[role];
  const streamKey = rewardOperationStreamKey(surface, rewardSurface);
  let streamState = roleState.streams.get(streamKey);
  if (streamState == null) {
    streamState = freshWatcherState();
    roleState.streams.set(streamKey, streamState);
  }
  if (streamState.ordinalStart !== pinned) {
    streamState.ordinal = 0;
    streamState.ordinalStart = pinned;
  }
  return { roleState, streamState };
}

// -----------------------------------------------------------------------------
// Owner seam (§1.3 propose -> commit). Dual-run: the phase still fires the legacy relay.
// -----------------------------------------------------------------------------

export interface CoopRewardOwnerCommitParams {
  readonly surface: CoopShopSurface;
  /** Ordered retained Mystery reward surface; absent for normal-wave rewards and markets. */
  readonly rewardSurface?: CoopRewardSurfaceIdentity | undefined;
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
export function commitRewardOwnerIntent(
  params: CoopRewardOwnerCommitParams,
  binding?: CoopRewardOperationBinding | null,
): CoopRewardOwnerCommitResult | null {
  if (!isCoopRewardOperationEnabled() || params.pinned < 0) {
    return null;
  }
  try {
    const s = state(binding);
    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const terminalKey = rewardStreamKey(params.surface, params.pinned, params.rewardSurface);
    const retainedTerminal = params.terminal ? s.ownerTerminalOperations.get(terminalKey) : undefined;
    const ordinal =
      retainedTerminal?.ordinal ?? nextOwnerOrdinal(s, params.pinned, params.surface, params.rewardSurface);
    const actionSlot = coopRewardOperationActionSlot(params.pinned, ordinal, params.rewardSurface);
    if (actionSlot == null) {
      return null;
    }
    const opId =
      retainedTerminal?.operationId ?? makeCoopOperationId(s.epoch, ownerSeat, actionSlot, kindFor(params.surface));
    if (params.terminal && retainedTerminal == null) {
      s.ownerTerminalOperations.set(terminalKey, { ordinal, operationId: opId });
    }
    const payload = buildPayload(
      params.surface,
      params.label,
      params.choice,
      params.data,
      params.terminal,
      params.rewardSurface,
    );
    const intent: CoopPendingOperation = {
      id: opId,
      kind: kindFor(params.surface),
      owner: ownerSeat,
      status: "proposed",
      payload,
    };
    const prepared: PreparedRewardIntent = {
      intent,
      surface: params.surface,
      rewardSurface: params.rewardSurface,
      pinned: params.pinned,
      terminal: params.terminal,
      wave: params.wave,
      turn: params.turn ?? 0,
      localRole: params.localRole,
      executing: false,
      watcherAdvanced: false,
    };
    if (!retainPreparedIntent(s, prepared)) {
      return null;
    }

    // A live journaled action is deliberately TWO-STAGE: this call retains the typed intent only. The phase
    // executes on the host at its safe seam, then commitRewardAuthoritativeResult captures the complete
    // post-action state. Thus no live envelope can carry the historical empty control placeholder.
    if (journalActive(binding)) {
      coopLog("reward", `${params.surface} op INTENT prepared label=${params.label} id=${opId}`);
      return { operationId: opId, revision: 0 };
    }

    // Compatibility when durability is disabled: preserve the former control-only local gate. This context
    // never reaches the wire, and the legacy relay remains the sole carrier.
    if (params.localRole === "host") {
      const res = host(binding).submit(
        intent,
        legacyControlContext(params.surface, params.wave, params.turn ?? 0),
        ownerParityValidator(params.pinned),
      );
      if (res.kind === "committed" || res.kind === "reack") {
        const canonicalPayload = res.kind === "reack" ? res.op.payload : res.envelope.pendingOperation?.payload;
        if (JSON.stringify(canonicalPayload) !== JSON.stringify(intent.payload)) {
          return null;
        }
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed action with the durability journal
        // (resend / reconnect replay). Rides ALONGSIDE the legacy relay (dual-run); no-op when durability OFF.
        if (!retainEnvelope(res.envelope, binding)) {
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
    if (isCoopOpRuntimeError(e)) {
      throw e; // a missing/wrong runtime here is a real defect - surface it, never mask as legacy fallback (#922)
    }
    coopWarn("reward", `${params.surface} op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2d)`, e);
    return null;
  }
}

/**
 * HOST safe seam: commit one previously prepared intent with the complete post-action engine state. The
 * exact envelope is cached before journal publication, so a failed publication retries the same state tick
 * and operation id instead of executing or recapturing the action a second time.
 */
export function commitRewardAuthoritativeResult(
  operationId: string,
  authoritativeState?: CoopAuthoritativeBattleStateV1 | null,
  binding?: CoopRewardOperationBinding | null,
): CoopRewardOwnerCommitResult | null {
  if (!isCoopRewardOperationEnabled() || !journalActive(binding)) {
    return null;
  }
  const s = state(binding);
  const key = preparedKey("host", operationId);
  const prepared = s.preparedIntents.get(key);
  if (prepared == null) {
    coopWarn("reward", `authoritative reward result has no prepared host intent id=${operationId}`);
    return null;
  }

  const retained = s.committedResultEnvelopes.get(operationId);
  if (retained != null) {
    if (!retainEnvelope(retained, binding)) {
      return null;
    }
    advancePreparedWatcher(prepared);
    return { operationId, revision: retained.revision };
  }

  const resultState = authoritativeState ?? authorityStateHooks.capture(prepared.turn);
  if (!isCompleteRewardAuthorityState(resultState, prepared.wave, prepared.turn)) {
    coopWarn(
      "reward",
      `authoritative reward result refused incomplete state id=${operationId} wave=${prepared.wave} turn=${prepared.turn}`,
    );
    return null;
  }
  const res = host(binding).submit(
    prepared.intent,
    authoritativeResultContext(prepared.surface, prepared.wave, prepared.turn, resultState),
    ownerParityValidator(prepared.pinned),
  );
  if (res.kind !== "committed" && res.kind !== "reack") {
    coopWarn("reward", `authoritative reward result rejected (${res.kind}) id=${operationId}`);
    return null;
  }
  if (
    !samePayload(
      res.kind === "reack" ? res.op.payload : res.envelope.pendingOperation?.payload,
      prepared.intent.payload,
    )
  ) {
    return null;
  }
  s.committedResultEnvelopes.set(operationId, res.envelope);
  if (!retainEnvelope(res.envelope, binding)) {
    return null;
  }
  advancePreparedWatcher(prepared);
  coopLog(
    "reward",
    `${prepared.surface} authoritative RESULT retained rev=${res.envelope.revision} tick=${resultState.tick} id=${operationId}`,
  );
  return { operationId, revision: res.envelope.revision };
}

function advancePreparedWatcher(prepared: PreparedRewardIntent): void {
  if (prepared.watcherRoleState == null || prepared.watcherState == null || prepared.watcherAdvanced) {
    return;
  }
  prepared.watcherAdvanced = true;
  prepared.watcherState.ordinal += 1;
  prepared.watcherRoleState.lastAdoptedStart = Math.max(prepared.watcherRoleState.lastAdoptedStart, prepared.pinned);
  if (prepared.terminal) {
    prepared.watcherState.lastLeftStart = Math.max(prepared.watcherState.lastLeftStart, prepared.pinned);
  }
}

// -----------------------------------------------------------------------------
// Watcher seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopRewardWatcherAdoptParams {
  readonly surface: CoopShopSurface;
  /** Ordered retained Mystery reward surface; absent for normal-wave rewards and markets. */
  readonly rewardSurface?: CoopRewardSurfaceIdentity | undefined;
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
 * OFF this skips journal gating but still requires an exact P36 surface address. When ON:
 *   - on the AUTHORITY watching a guest-owned action, VALIDATE + COMMIT the guest's intent (invariant 3);
 *   - REJECT a stale pick from a strictly-earlier interaction (`pin < lastAdoptedStart`, #861) or a late
 *     pick for an interaction already LEFT (`pin <= lastLeftStart`), and de-dupe an exact re-delivery by
 *     operationId (invariants 5, 6). On a reject the CALLER ignores the action and keeps awaiting the
 *     authoritative terminal (exactly like the existing #854 out-of-range guard).
 * Never throws (a throw returns `adopt:false` -> the caller skips the action, never crashing the watcher).
 */
export function adoptRewardWatcherChoice(
  params: CoopRewardWatcherAdoptParams,
  binding?: CoopRewardOperationBinding | null,
): CoopRewardAdoptDecision {
  if (params.action == null) {
    return { adopt: false, reason: "no-relay" };
  }
  if (rewardSurfaceKey(params.action.rewardSurface) !== rewardSurfaceKey(params.rewardSurface)) {
    return { adopt: false, reason: "reward-surface-mismatch" };
  }
  // Legacy / fallback still enforces the P36 surface address; it skips only operation-journal gating.
  if (!isCoopRewardOperationEnabled()) {
    return { adopt: true };
  }
  if (params.pinned < 0) {
    // Unpinned interaction (should not happen in a live run): fall through to the legacy apply.
    return { adopt: true };
  }
  try {
    const s = state(binding);
    const { roleState, streamState: ws } = watcherState(
      s,
      params.localRole,
      params.surface,
      params.pinned,
      params.rewardSurface,
    );
    // Stale / late rejection (invariant 6, the #861 shape). The pinned interaction counter is monotonic, so:
    //  - a pick STRICTLY BELOW the highest interaction we have adopted at is a leftover from an interaction a
    //    later one already superseded (the cross-interaction stale buffer);
    //  - a pick AT OR BELOW the highest interaction we have LEFT is a late choice for an interaction we
    //    already terminated (the late-after-leave shape).
    // Within a live interaction (pin > both) every action passes, so a legitimate stream of buys is adopted.
    if (params.pinned < roleState.lastAdoptedStart || params.pinned <= ws.lastLeftStart) {
      coopWarn(
        "reward",
        `${params.surface} op WATCHER REJECT stale/late pin=${params.pinned} adoptedStart=${roleState.lastAdoptedStart} leftStart=${ws.lastLeftStart} stream=${rewardSurfaceKey(params.rewardSurface)} role=${params.localRole} (Wave-2d)`,
      );
      return { adopt: false, reason: "stale-or-late" };
    }

    const ownerSeat = coopInteractionOwnerSeat(params.pinned);
    const ordinal = ws.ordinal;
    const actionSlot = coopRewardOperationActionSlot(params.pinned, ordinal, params.rewardSurface);
    if (actionSlot == null) {
      return { adopt: false, reason: "invalid-surface-action-address" };
    }
    const opId = makeCoopOperationId(s.epoch, ownerSeat, actionSlot, kindFor(params.surface));
    const payload = buildPayload(
      params.surface,
      relayedLabel(params.surface, params.action),
      params.action.choice,
      params.action.data,
      params.terminal,
      params.rewardSurface,
    );
    const intent: CoopPendingOperation = {
      id: opId,
      kind: kindFor(params.surface),
      owner: ownerSeat,
      status: "proposed",
      payload,
    };

    // The AUTHORITY (host) watching a guest-owned action first validates and retains the INTENT. The phase
    // executes it exactly once, then calls commitRewardAuthoritativeResult at the post-action safe seam.
    if (params.localRole === "host") {
      if (journalActive(binding)) {
        if (!ownerParityValidator(params.pinned)(intent).ok) {
          return { adopt: false, reason: "host-wrong-owner" };
        }
        const key = preparedKey("host", opId);
        const existing = s.preparedIntents.get(key);
        if (existing?.executing || s.committedResultEnvelopes.has(opId)) {
          return { adopt: false, reason: "host-intent-in-flight-or-complete" };
        }
        const prepared: PreparedRewardIntent = {
          intent,
          surface: params.surface,
          rewardSurface: params.rewardSurface,
          pinned: params.pinned,
          terminal: params.terminal,
          wave: params.wave,
          turn: params.turn ?? 0,
          localRole: "host",
          watcherRoleState: roleState,
          watcherState: ws,
          executing: true,
          watcherAdvanced: false,
        };
        if (!retainPreparedIntent(s, prepared)) {
          return { adopt: false, reason: "host-intent-payload-conflict" };
        }
        const retainedPrepared = s.preparedIntents.get(key);
        if (retainedPrepared != null) {
          retainedPrepared.executing = true;
        }
        return {
          adopt: true,
          operationId: opId,
          authoritativeProjection: false,
          requiresAuthorityCommit: true,
        };
      }
      const res = host(binding).submit(
        intent,
        legacyControlContext(params.surface, params.wave, params.turn ?? 0),
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
        if (!retainEnvelope(res.envelope, binding)) {
          return { adopt: false, reason: "host-journal-not-retained" };
        }
        // The authoritative host applies its validated guest-owned action at this safe phase seam.
        // The remote guest remains envelope-gated and merely ACKs/dedupes its already-proposed action.
        ws.ordinal += 1;
        roleState.lastAdoptedStart = Math.max(roleState.lastAdoptedStart, params.pinned);
        if (params.terminal) {
          ws.lastLeftStart = Math.max(ws.lastLeftStart, params.pinned);
        }
        return { adopt: true, operationId: opId };
      }
      return { adopt: false, reason: "host-duplicate" };
    }

    // Once the durability journal wins one action in this pinned FIFO, it leads the remainder of the
    // interaction. Ignore raw legacy echoes (or raw later actions that raced ahead) and await their tagged
    // committed envelope. This prevents a reordered echo from being mistaken for the next ordinal.
    if (s.journalLeadingStarts.has(params.pinned) && params.action.operationId !== opId) {
      return { adopt: false, reason: "await-journal" };
    }

    // The journal consumes the ONE shared ledger before the safe phase loop resumes. A tagged durable action
    // with the matching one-shot marker is therefore legitimate materialization, not a duplicate.
    if (guest(binding).hasApplied(opId)) {
      if (params.action.operationId === opId && s.pendingJournalMaterializations.delete(opId)) {
        ws.ordinal += 1;
        roleState.lastAdoptedStart = Math.max(roleState.lastAdoptedStart, params.pinned);
        if (params.terminal) {
          ws.lastLeftStart = Math.max(ws.lastLeftStart, params.pinned);
        }
        coopLog(
          "reward",
          `${params.surface} op WATCHER materialize JOURNAL choice=${params.action.choice} terminal=${params.terminal} id=${opId}`,
        );
        return { adopt: true, operationId: opId, authoritativeProjection: true };
      }
      coopWarn("reward", `${params.surface} op WATCHER REJECT duplicate id=${opId} (Wave-2d)`);
      return { adopt: false, reason: "duplicate" };
    }

    if (journalActive(binding)) {
      return { adopt: false, reason: "await-authoritative-envelope" };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op).
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    const g = guest(binding);
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn ?? 0,
      logicalPhase: params.surface === "reward" ? "REWARD_SELECT" : "SHOP",
      pendingOperation: appliedOp,
      authoritativeState: legacyControlContext(params.surface, params.wave, params.turn ?? 0).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("reward", `${params.surface} op WATCHER guest non-applied (${applyRes.kind}) id=${opId} (Wave-2d)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }

    // Advance the watcher order + ordinal ONLY on a successful adoption (§8.2: never on the owner's commit).
    ws.ordinal += 1;
    roleState.lastAdoptedStart = Math.max(roleState.lastAdoptedStart, params.pinned);
    if (params.terminal) {
      ws.lastLeftStart = Math.max(ws.lastLeftStart, params.pinned);
    }
    coopLog(
      "reward",
      `${params.surface} op WATCHER adopt choice=${params.action.choice} terminal=${params.terminal} id=${opId} (Wave-2d)`,
    );
    return { adopt: true, operationId: opId };
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      // A missing/wrong runtime here means this watcher continuation lost its captured runtime binding.
      // Do NOT degrade to {adopt:true}: that silently
      // hangs the watcher (no operationId/authoritativeProjection) - the #922 reward-mirror regression. Surface it.
      throw e;
    }
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
  const s = state();
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate"; // already converged via the journal (a reconnect resend re-delivery) - ACK, no re-apply.
  }
  const inspected = g.inspectEnvelope(envelope);
  if (inspected.kind !== "applied") {
    return inspected.kind === "duplicate" ? "duplicate" : "rejected";
  }
  if (!isCompleteRewardAuthorityState(envelope.authoritativeState, envelope.wave, envelope.turn)) {
    coopWarn("reward", `shop result rejected empty/incomplete authoritative state id=${op.id}`);
    return "rejected";
  }
  if (!s.stateAppliedOperations.has(op.id)) {
    const stateApplied = authorityStateHooks.apply(envelope.authoritativeState);
    if (!stateApplied) {
      return "rejected";
    }
    s.stateAppliedOperations.add(op.id);
  } else if (!authorityStateHooks.reapply(envelope.authoritativeState)) {
    // A retry after the state seam succeeded but before the live UI sink accepted must reassert exactly the
    // same immutable result. It never executes the reward/shop action locally a second time.
    return "rejected";
  }
  const rewardApply = applyCoopOperationEnvelope(g, "op:reward", envelope);
  if (rewardApply !== "applied") {
    return rewardApply; // transient non-applicable (retriable/deferred); never a permanent condition (that is a duplicate above).
  }
  // Route the newly-consumed action into the production sink. It feeds the tagged committed choice into the
  // receiver's existing reward/market FIFO; the phase remains the sole safe mutation site.
  coopLog(
    "reward",
    `shop authoritative RESULT applied-before-render kind=${op.kind} id=${op.id} rev=${envelope.revision} tick=${envelope.authoritativeState.tick}`,
  );
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
  rewardSurface?: CoopRewardSurfaceIdentity,
): CoopRewardActionPayload | CoopShopBuyPayload {
  return surface === "reward"
    ? ({
        label,
        choice,
        data,
        terminal,
        ...(rewardSurface == null ? {} : { rewardSurface }),
      } satisfies CoopRewardActionPayload)
    : ({ slot: choice, data, terminal } satisfies CoopShopBuyPayload);
}

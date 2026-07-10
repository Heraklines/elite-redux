/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op AUTHORITATIVE OPERATION ENVELOPE (Wave-2 authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §1).
//
// The envelope is the single authoritative CONTROL+DATA unit the host broadcasts on
// every commit. It is a strict SUPERSET of today's turnResolution / waveEndState
// payload: the existing `authoritativeState` (the DATA plane) becomes ONE field of it
// (§1.2), so an older client that only reads `authoritativeState` keeps working during
// migration. The NEW work is the four CONTROL fields (sessionEpoch, revision,
// logicalPhase, pendingOperation) - the mon serialization is untouched.
//
// This module is PURE TYPES + tiny pure helpers (id mint/parse + closed-union guards);
// it has zero engine/transport dependency so the lifecycle is unit-testable headlessly
// (exactly like coop-interaction.ts). The runtime that drives ops through the lifecycle
// lives in coop-operation-runtime.ts; the wire delivery + surface wiring is layered on
// top and is individually flag-gated (§5).
// =============================================================================

import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

/** A co-op player seat id (0..N-1). The host/authority is a specific id, conventionally 0. */
export type CoopPlayerId = number;

/** The monotonic session identity. Bumps ONLY on a hard control-plane reset (§1.4). */
export type CoopSessionEpoch = number;

/** Per-committed-operation monotonic revision within an epoch (§1.5). Never resets except on epoch bump. */
export type CoopRevision = number;

/**
 * Globally unique id for one operation, minted by the PROPOSER (host or guest) (§1.3, §1.8):
 * `${epoch}:${owner}:${pinnedSeq}`. Unique WITHOUT a host round-trip, and it embeds its epoch so
 * the idempotency + late-rejection machinery (§1.6) is structural, not per-call-site.
 */
export type CoopOperationId = string;

/**
 * The logical run phase - the authoritative control-plane position. The host STATES this; the guest
 * ADOPTS it and never infers it from a one-bit outcome (§1.1). CLOSED union: an unknown value on the
 * guest FAILS CLOSED (§1.7), it does not fall back to running a local phase.
 */
export type CoopLogicalPhase =
  | "COMMAND" // awaiting battle commands (CommandPhase / TurnStartPhase)
  | "TURN_RESOLVE" // host resolving a turn; guest renders (CoopReplayTurnPhase)
  | "WAVE_VICTORY" // wave won/captured; VictoryPhase tail
  | "WAVE_FLEE" // fled; BattleEnd -> NewBattle tail
  | "GAME_OVER" // run lost; GameOverPhase
  | "REWARD_SELECT" // between-wave reward shop (UiMode.MODIFIER_SELECT)
  | "BIOME_SELECT" // ER map / crossroads route choice
  | "MYSTERY_ENCOUNTER" // ME option/battle handoff
  | "SHOP" // biome market / black market / exotic / bazaar
  | "INTERACTION" // any other runCoopInteraction-driven shared screen
  | "IDLE"; // no pending control transition

/** The lifecycle status of the ONE in-flight operation (§1.3). Terminal: applied/rejected/superseded. */
export type CoopOperationStatus = "proposed" | "committed" | "applied" | "rejected" | "superseded";

/**
 * WHAT an operation is - the migrated successor of today's relay `kind` (coop-seq-registry.ts).
 * ONE closed union; an unknown kind on the guest FAILS CLOSED (§1.7, §4.5). The full table is the
 * §2 inventory so every later surface reuses this union unchanged; Wave-2a only WIRES the two
 * biome-travel kinds (BIOME_PICK, CROSSROADS_PICK) - the rest are declared for the migration order.
 */
export type CoopOperationKind =
  // --- Wave-2a: biome travel (§2.1 #14/#15, BIOME_SELECT) ---
  | "BIOME_PICK" // World-Map / single-node biome travel (#15)
  | "CROSSROADS_PICK" // crossroads Stay/Leave route choice (#14)
  // --- Later waves (declared for the closed union; not wired in Wave-2a) ---
  | "REWARD" // reward shop pick/skip/reroll/etc (#1, REWARD_SELECT)
  | "SHOP_BUY" // biome/black-market/exotic/bazaar buy (#5, SHOP)
  | "FAINT_SWITCH" // faint replacement / voluntary switch (#2)
  | "REVIVAL" // revival blessing target (#3)
  | "ABILITY_PICK" // ability capsule pick (#4)
  | "BARGAIN" // Giratina bargain (#6)
  | "COLO_PICK" // colosseum board pick (#7)
  | "ME_PRESENT" // ME presentation handoff (#8)
  | "ME_PICK" // ME option select (#8)
  | "ME_SUB" // ME sub-prompt (#8)
  | "ME_BUTTON" // ME button press (#8)
  | "ME_TERMINAL" // ME terminal LEAVE/handoff (#10)
  | "QUIZ_ANSWER" // ER quiz answer (#9)
  | "LEARN_MOVE" // learn-move accept/decline (#11)
  | "LEARN_MOVE_BATCH" // batch level-up learn panel (#12)
  | "STORMGLASS" // one-time weather pick (#16)
  | "CATCH_FULL"; // wild-catch full-party release (#17)

/** A single unit of shared-run mutation moving through the lifecycle (§1.3). */
export interface CoopPendingOperation {
  /** Globally-unique id (proposer-minted). Idempotency key component (§1.6). */
  readonly id: CoopOperationId;
  /** WHAT this operation is - the migrated successor of the relay `kind`. Unknown kinds fail closed (§1.7). */
  readonly kind: CoopOperationKind;
  /** The player seat that DRIVES/PROPOSES it (0..N-1). Successor of the interaction-counter owner rule (§1.8). */
  readonly owner: CoopPlayerId;
  /** Current lifecycle state. */
  readonly status: CoopOperationStatus;
  /**
   * The typed INTENT (guest->host, invariant 2) or committed outcome (host->guest, invariant 4).
   * Serializable; the successor of the relay choice/outcome payload. Narrowed per-kind by the guards below.
   */
  readonly payload: unknown;
  /**
   * Why the op was rejected, present ONLY when status === "rejected" (§1.3). Lets the proposer surface a
   * safe default and the diagnostics log the cause. Absent on every non-rejected status.
   */
  readonly rejectReason?: string;
}

/** The single authoritative control+data unit the host broadcasts every commit (§1.1). */
export interface CoopAuthoritativeEnvelopeV1 {
  readonly version: 1;
  readonly sessionEpoch: CoopSessionEpoch;
  readonly revision: CoopRevision;
  readonly wave: number; // successor of CoopAuthoritativeBattleStateV1.wave
  readonly turn: number; // successor of CoopAuthoritativeBattleStateV1.turn
  readonly logicalPhase: CoopLogicalPhase;
  /** The one in-flight operation, or null when the control plane is quiescent. */
  readonly pendingOperation: CoopPendingOperation | null;
  /** The existing authoritative DATA plane, embedded UNCHANGED (§1.2). */
  readonly authoritativeState: CoopAuthoritativeBattleStateV1;
}

// -----------------------------------------------------------------------------
// Per-kind payload shapes (the discriminated map §1.1 references). Wave-2a defines the
// two biome-travel payloads; later surfaces add their own. All are plain-JSON serializable.
// -----------------------------------------------------------------------------

/** BIOME_PICK intent/outcome: the chosen biome + the route-node index the owner travelled to (#15/#865). */
export interface CoopBiomePickPayload {
  /** The BiomeId the owner chose to travel to. */
  readonly biomeId: number;
  /**
   * The index into the routing pending-node set (getErPendingNodes) the owner picked, or -1 for the
   * natural single-node terminal (#865 - the World-Map auto-travel path with exactly one destination).
   */
  readonly nodeIndex: number;
}

/** CROSSROADS_PICK intent/outcome: the crossroads option index the owner chose (Stay/Leave, #14). */
export interface CoopCrossroadsPickPayload {
  /** The crossroads option index the owner selected (0 = Stay, 1 = Leave, per the phase's option order). */
  readonly optionIndex: number;
}

/**
 * REWARD intent/outcome (Wave-2d, #1, REWARD_SELECT): one relayed reward-screen ACTION. Unlike biome
 * travel (one pick per interaction), the reward shop relays a STREAM of actions on the same pinned
 * interaction until a terminal (skip/leave, or a non-continuation reward grab). Each action - a reward
 * pick, a shop buy, a reroll, a lock, a transfer, a Check-Team op - is ONE operation. A NESTED sub-pick
 * (party target slot / TM move slot / ability slot / fusion pair) is folded into THIS payload's `data`
 * (a "multi-step op payload", §8.2 Wave-2d) - it is NOT a separate sub-operation: the reward shop already
 * collapses the party-target menu into the single terminal relay this operation carries.
 */
export interface CoopRewardActionPayload {
  /** The wire `label` the legacy relay sent this action with (reward/shop/skip/reroll/check/transfer/lock). */
  readonly label: string;
  /** The picked option/cursor index, or a sentinel (COOP_INTERACTION_LEAVE = -1 / _REROLL = -2). */
  readonly choice: number;
  /** The relay `data` array (the act-code + any resolved sub-pick indices), verbatim; undefined when none. */
  readonly data: number[] | undefined;
  /** True iff this action LEAVES the interaction for good (skip / leave) - the late-after-leave watermark trigger. */
  readonly terminal: boolean;
}

/**
 * SHOP_BUY intent/outcome (Wave-2d, #5, SHOP): one relayed biome-market (BiomeShop / BlackMarket / Exotic /
 * ImportBazaar) action - a buy (slot into the streamed stock + resolved party target + post-buy money) or
 * the LEAVE terminal. Shares the reward shop's multi-action stream shape; the biome market pins on
 * coopBiomeStart (the same monotonic interaction counter the reward shop pins coopInteractionStart on).
 */
export interface CoopShopBuyPayload {
  /** The bought slot into the owner-streamed stock, or COOP_INTERACTION_LEAVE (-1) for the market terminal. */
  readonly slot: number;
  /** The relay `data` array ([targetPartySlot, moneyAfter] for a buy), verbatim; undefined when none. */
  readonly data: number[] | undefined;
  /** True iff this action LEAVES the market for good - the late-after-leave watermark trigger. */
  readonly terminal: boolean;
}

// -----------------------------------------------------------------------------
// Pure helpers: id mint/parse + closed-union guards. Zero engine dependency.
// -----------------------------------------------------------------------------

/**
 * Mint an operation id from its three components (§1.8): `${epoch}:${owner}:${pinnedSeq}`. `pinnedSeq`
 * is the interaction-counter value (or biome pin) the op was pinned at, so the id embeds BOTH its epoch
 * (cross-epoch rejection) AND the counter it advanced past (the peerAdvancedPastInteraction successor).
 */
export function makeCoopOperationId(epoch: CoopSessionEpoch, owner: CoopPlayerId, pinnedSeq: number): CoopOperationId {
  return `${epoch}:${owner}:${pinnedSeq}`;
}

/** Parse an operation id back into its components, or null if it is not a well-formed id. */
export function parseCoopOperationId(
  id: CoopOperationId,
): { epoch: CoopSessionEpoch; owner: CoopPlayerId; pinnedSeq: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const epoch = Number(parts[0]);
  const owner = Number(parts[1]);
  const pinnedSeq = Number(parts[2]);
  if (!Number.isInteger(epoch) || !Number.isInteger(owner) || !Number.isInteger(pinnedSeq)) {
    return null;
  }
  return { epoch, owner, pinnedSeq };
}

/** The closed set of logical phases the guest recognizes. A value outside it FAILS CLOSED (§1.7). */
const KNOWN_LOGICAL_PHASES: ReadonlySet<CoopLogicalPhase> = new Set<CoopLogicalPhase>([
  "COMMAND",
  "TURN_RESOLVE",
  "WAVE_VICTORY",
  "WAVE_FLEE",
  "GAME_OVER",
  "REWARD_SELECT",
  "BIOME_SELECT",
  "MYSTERY_ENCOUNTER",
  "SHOP",
  "INTERACTION",
  "IDLE",
]);

/** The closed set of operation kinds the guest recognizes. A value outside it FAILS CLOSED (§1.7). */
const KNOWN_OPERATION_KINDS: ReadonlySet<CoopOperationKind> = new Set<CoopOperationKind>([
  "BIOME_PICK",
  "CROSSROADS_PICK",
  "REWARD",
  "SHOP_BUY",
  "FAINT_SWITCH",
  "REVIVAL",
  "ABILITY_PICK",
  "BARGAIN",
  "COLO_PICK",
  "ME_PRESENT",
  "ME_PICK",
  "ME_SUB",
  "ME_BUTTON",
  "ME_TERMINAL",
  "QUIZ_ANSWER",
  "LEARN_MOVE",
  "LEARN_MOVE_BATCH",
  "STORMGLASS",
  "CATCH_FULL",
]);

/** True iff `phase` is a logical phase the guest recognizes (else it must fail closed, §1.7). */
export function isKnownCoopLogicalPhase(phase: string): phase is CoopLogicalPhase {
  return KNOWN_LOGICAL_PHASES.has(phase as CoopLogicalPhase);
}

/** True iff `kind` is an operation kind the guest recognizes (else it must fail closed, §1.7). */
export function isKnownCoopOperationKind(kind: string): kind is CoopOperationKind {
  return KNOWN_OPERATION_KINDS.has(kind as CoopOperationKind);
}

/** True iff `status` is one of the three TERMINAL states (applied/rejected/superseded, §1.3). */
export function isTerminalCoopOperationStatus(status: CoopOperationStatus): boolean {
  return status === "applied" || status === "rejected" || status === "superseded";
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Interactions lane 1: the REWARD / MARKET / BIOME adapter.
//
// This is the typed authority-v2 successor of three legacy between-wave
// interaction carriers, collapsed onto the ONE INTERACTION_COMMIT entry kind in
// the ONE global revision order (frozen decision 1):
//   - the reward-shop stream (coop-reward-operation.ts CoopRewardActionPayload:
//     reward/shop/skip/reroll/check/transfer/lock, choice sentinels
//     COOP_INTERACTION_LEAVE / _REROLL, the party-target sub-pick folded into
//     data[]),
//   - the market/shop-buy stream (CoopShopBuyPayload: slot into the streamed
//     stock, data = [targetPartySlot, moneyAfter], slot === -1 == market LEAVE),
//   - the biome/crossroads picks (coop-biome-operation.ts CoopBiomePickPayload
//     { sourceBiomeId, biomeId, nodeIndex, nextWave } and CoopCrossroadsPickPayload
//     { optionIndex: 0 Stay | 1 Leave }, and the select-biome / er-crossroads
//     co-op owner/watcher paths).
//
// THE INVERSION (frozen decision 4): the AUTHORITY STATES the resolved interaction
// as typed material AND the canonical successor control on ONE CoopAuthorityEntry;
// the REPLICA ADOPTS that material and PROJECTS that control. The legacy path
// DERIVED the successor from the local phase queue (crossroads STAY -> queued
// NewBattlePhase, LEAVE -> unshiftNew SelectBiomePhase). Here the successor is a
// first-class stated CoopNextControl - COMMAND for the next wave, or a REWARD /
// BIOME / MYSTERY chain - never derived by the guest.
//
// THE WATCHER-CLOSE (frozen ownership rules): a committed entry CLOSES the
// non-owner's open watcher surface through the ORDERED material apply (the applier
// adopts the committed image into the open watcher, then installs), replacing the
// legacy "materialize the committed choice into the guest's relay FIFO"
// side-channel + the suppressed raw-relay echo. There is no side channel: the
// authority-close is part of the exactly-once material apply.
//
// ENGINE-FREE: every contract import is TYPE-ONLY; the sole runtime imports are the
// pure authority-entry / next-control helpers. There is NO Phaser, NO globalScene,
// NO getCoopRuntime, NO legacy coop netcode import at runtime, and NO module-global
// mutable state - every function is pure over its arguments (or over an injected
// sink / the passed CoopRuntimeContext). The whole file runs in the node-pure
// vitest lane.
// =============================================================================

import { isValidOperationId, isValidRevision } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopAuthorityEntryKind,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type { ApplyMaterialFn } from "#data/elite-redux/coop/authority-v2/replica";

// ---------------------------------------------------------------------------
// Shared - kind, surface discriminant, successor, build error.
// ---------------------------------------------------------------------------

/** The entry kind every surface in this lane commits (frozen decision 1). */
export const INTERACTION_COMMIT_KIND: CoopAuthorityEntryKind = "INTERACTION_COMMIT";

/** Which interaction surface a piece of material belongs to (the material discriminant). */
export type CoopInteractionSurface = "reward" | "market" | "biome";

/**
 * The successor control the AUTHORITY may state after an interaction (frozen
 * decision 4). It is a plain {@link CoopNextControl} restricted to the destinations
 * an interaction can legally chain to: COMMAND (the next wave's first command),
 * REWARD / BIOME / MYSTERY (another between-wave interaction in the chain), or
 * `null` (the interaction states no successor and retires at materialApplied). A
 * TERMINAL is NEVER an interaction's job (that is the wave-terminal adapter) and a
 * REPLACEMENT is a faint's, so both are excluded by construction.
 */
export type CoopInteractionSuccessor = Extract<
  ProjectableControl,
  { kind: "COMMAND_FRONTIER" | "REWARD" | "BIOME" | "MYSTERY" }
> | null;

/** Thrown by the authority-side builders on malformed input: an authority must NEVER commit a malformed entry. */
export class CoopInteractionBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoopInteractionBuildError";
  }
}

// ---------------------------------------------------------------------------
// Deterministic material digest (canonical JSON + FNV-1a, identical scheme as
// the wave-terminal adapter). Prefixed with the material kind so a reward, a
// market, and a biome payload can never collide on a shared hash. Identical on
// every client, so a redelivered entry proves identical and the replica confirms
// the digest of the material it adopts.
// ---------------------------------------------------------------------------

/**
 * Stable canonical JSON of a plain-JSON value: object keys sorted at every depth
 * so two structurally-equal payloads serialize byte-identically; arrays keep their
 * order (it is meaningful, e.g. the folded sub-pick `data[]`).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",");
  return `{${body}}`;
}

/** FNV-1a 32-bit hash of a string, as 8-char zero-padded hex. Deterministic, dependency-free. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (avoids float precision loss on *16777619).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Any concrete material this lane commits (the union the digest + appliers narrow). */
export type CoopInteractionMaterialV2 =
  | CoopRewardInteractionMaterialV2
  | CoopMarketInteractionMaterialV2
  | CoopBiomeInteractionMaterialV2;

/**
 * The deterministic digest of a piece of interaction material. The material's
 * surface `kind` prefixes the hash so cross-surface payloads never collide.
 */
export function digestOfInteractionMaterial(material: CoopInteractionMaterialV2): string {
  return `${material.kind}:${fnv1a32(canonicalJson(material))}`;
}

// ---------------------------------------------------------------------------
// Shared validation primitives.
// ---------------------------------------------------------------------------

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isSafeNonNegInt(value: unknown): value is number {
  return isSafeInt(value) && (value as number) >= 0;
}

function isSafePositiveInt(value: unknown): value is number {
  return isSafeInt(value) && (value as number) > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate + stamp the authority-stated successor onto an entry. Non-null controls
 * are checked for the interaction-legal kind set AND structural well-formedness; a
 * malformed / out-of-set successor throws (the authority never commits an entry
 * whose stated successor could not be projected).
 */
function assertInteractionSuccessor(successor: CoopInteractionSuccessor): CoopNextControl {
  if (successor == null) {
    return null;
  }
  const kind: string = (successor as ProjectableControl).kind;
  if (kind !== "COMMAND_FRONTIER" && kind !== "REWARD" && kind !== "BIOME" && kind !== "MYSTERY") {
    throw new CoopInteractionBuildError(
      `interaction successor must be COMMAND_FRONTIER | REWARD | BIOME | MYSTERY or null (got ${kind})`,
    );
  }
  const validation = validateNextControl(successor);
  if (!validation.ok) {
    throw new CoopInteractionBuildError(`interaction successor is malformed: ${validation.reason}`);
  }
  return successor;
}

/** Dedupe + sort a subsumes list and reject any non-positive/duplicate revision (fail loud at build). */
function normalizeSubsumes(subsumes: readonly number[] | undefined): readonly number[] {
  if (subsumes == null || subsumes.length === 0) {
    return [];
  }
  const seen = new Set<number>();
  for (const revision of subsumes) {
    if (!isValidRevision(revision)) {
      throw new CoopInteractionBuildError(`subsumes revision must be a positive safe integer (got ${revision})`);
    }
    seen.add(revision);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Assemble the concrete {@link CoopAuthoritativeMaterial} (digest + payload) for a validated material. */
function toMaterial(material: CoopInteractionMaterialV2): CoopAuthoritativeMaterial {
  return { digest: digestOfInteractionMaterial(material), payload: material };
}

// ===========================================================================
// SURFACE 1 - REWARD (pick / skip / leave). Owner-seat addressed; a shop is a
// STREAM of actions on one pinned window, so the operationId carries a monotonic
// per-window action ordinal (the legacy pinnedSeq stream discipline).
// ===========================================================================

/**
 * The owner's resolved reward choice:
 *   - "pick"  - the owner selected reward `optionIndex`; `subPicks` folds the
 *               party-target / TM-slot / ability-slot sub-selection the legacy
 *               path collapsed into `data[]` (empty when there is no sub-pick).
 *   - "skip"  - the owner declined the reward option (legacy label "skip").
 *   - "leave" - the owner closed the shop for good (legacy skip + terminal).
 */
export type CoopRewardChoiceV2 =
  | { readonly kind: "pick"; readonly optionIndex: number; readonly subPicks: readonly number[] }
  | { readonly kind: "skip" }
  | { readonly kind: "leave" };

/**
 * The authoritative reward IMAGE - the typed, digestible material the log retains
 * and the replica installs. `terminal` states whether this action LEAVES the reward
 * interaction for good (a "leave"/"skip" is always terminal; a continuation reward
 * such as an Ability Capsule / TM keeps the window open, so a "pick" may be
 * non-terminal). The owner seat authorizes ownership (seat ids, never host/guest).
 */
export interface CoopRewardInteractionMaterialV2 {
  readonly kind: "reward";
  readonly wave: number;
  readonly ownerSeatId: number;
  readonly choice: CoopRewardChoiceV2;
  readonly terminal: boolean;
}

/** Whether a value is a well-formed reward choice. */
export function isValidRewardChoice(value: unknown): value is CoopRewardChoiceV2 {
  if (!isPlainObject(value)) {
    return false;
  }
  switch (value.kind) {
    case "pick":
      return isSafeNonNegInt(value.optionIndex) && Array.isArray(value.subPicks) && value.subPicks.every(isSafeInt);
    case "skip":
    case "leave":
      return true;
    default:
      return false;
  }
}

/** Whether a value is COMPLETE reward material. */
export function isValidRewardInteractionMaterial(value: unknown): value is CoopRewardInteractionMaterialV2 {
  return (
    isPlainObject(value)
    && value.kind === "reward"
    && isSafeNonNegInt(value.wave)
    && isSafeNonNegInt(value.ownerSeatId)
    && typeof value.terminal === "boolean"
    && isValidRewardChoice(value.choice)
  );
}

// ---------------------------------------------------------------------------
// The interaction WINDOW address + operationId (shared by reward + market; a
// window is a stream of ordinaled actions on one pinned interaction).
// ---------------------------------------------------------------------------

/**
 * The stable address of one owner-addressed interaction WINDOW. `actionOrdinal` is
 * the monotonic per-window action index (a shop / market is a stream: buy, lock,
 * reroll, ... leave), so each action in the stream is a DISTINCT operation identity
 * - the legacy pinnedSeq stream ordinal, promoted to a named field. Owner seat is
 * carried explicitly here (the legacy path derived it from counter parity; the
 * authority states the resolved owner directly).
 */
export interface CoopInteractionWindowAddress {
  /** Session epoch (positive). */
  readonly epoch: number;
  /** 1-based wave the interaction resolves on. */
  readonly wave: number;
  /** The seat that owns the window (seat ids authorize ownership, never host/guest role). */
  readonly ownerSeatId: number;
  /** Monotonic per-window action ordinal (0-based); makes each streamed action a distinct op. */
  readonly actionOrdinal: number;
}

/** The stable operationId for a reward-window action (addresses receipts + watcher/lease owners). */
export function rewardOperationId(address: CoopInteractionWindowAddress): string {
  return `IREW/e${address.epoch}/w${address.wave}/s${address.ownerSeatId}/a${address.actionOrdinal}`;
}

/** The stable operationId for a market-window action. Disjoint prefix from the reward stream. */
export function marketOperationId(address: CoopInteractionWindowAddress): string {
  return `IMKT/e${address.epoch}/w${address.wave}/s${address.ownerSeatId}/a${address.actionOrdinal}`;
}

// ---------------------------------------------------------------------------
// AUTHORITY - build the reward INTERACTION_COMMIT entry.
// ---------------------------------------------------------------------------

/** Inputs for {@link buildRewardInteractionEntry}. */
export interface BuildRewardInteractionEntryInput {
  /** The authenticated frame context stamped on the entry (mandatory, decision 3). */
  readonly context: CoopFrameContextV2;
  /** The stable operation identity (default {@link rewardOperationId} over `address`). */
  readonly operationId?: string;
  /** The window address the derived operationId is minted from (required when `operationId` is absent). */
  readonly address?: CoopInteractionWindowAddress;
  /** The resolved reward material. */
  readonly material: CoopRewardInteractionMaterialV2;
  /** The authority-stated successor control (COMMAND next wave, or REWARD/BIOME/MYSTERY chain, or null). */
  readonly successor: CoopInteractionSuccessor;
  /** Revisions this entry explicitly subsumes (supersession by log order); default none. */
  readonly subsumes?: readonly number[];
}

/**
 * Build the ONE authoritative reward INTERACTION_COMMIT entry. Throws on malformed
 * material / operationId / successor (an authority never commits a malformed entry).
 * Returns the exact `Omit<CoopAuthorityEntry, "revision">` the foundation
 * {@linkcode CoopAuthorityLog.commit} accepts - it assigns the global revision.
 */
export function buildRewardInteractionEntry(
  input: BuildRewardInteractionEntryInput,
): Omit<CoopAuthorityEntry, "revision"> {
  if (!isValidRewardInteractionMaterial(input.material)) {
    throw new CoopInteractionBuildError("reward material is not complete");
  }
  const operationId = resolveOperationId(input.operationId, input.address, rewardOperationId);
  const nextControl = assertInteractionSuccessor(input.successor);
  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: toMaterial(input.material),
    nextControl,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

// ---------------------------------------------------------------------------
// REPLICA - decode + verify, and the applier + watcher-close seam.
// ---------------------------------------------------------------------------

/**
 * Decode + verify a reward entry's material back into a typed image. Returns `null`
 * when the entry is not a well-formed reward INTERACTION_COMMIT or its digest does
 * not match the payload (a tampered / mismatched redelivery), so the applier
 * rejects it instead of installing unverified state.
 */
export function decodeRewardInteractionMaterial(entry: CoopAuthorityEntry): CoopRewardInteractionMaterialV2 | null {
  return decodeInteractionMaterial(entry, "reward", isValidRewardInteractionMaterial);
}

/**
 * A locally-open watcher surface (the non-owner's mirror of the owner's reward UI)
 * bound to exactly one operationId. A committed entry ADOPTS the authoritative image
 * through this seam and closes the mirror. `adopt` MUST be idempotent + non-throwing
 * (a redelivered entry re-applies): it is the ordered-apply authority-close that
 * replaces the legacy relay-FIFO materialization side channel.
 */
export interface OpenInteractionWatcher<TImage> {
  readonly operationId: string;
  /** Close the watcher and adopt the committed image. Idempotent; must not throw. */
  adopt(image: TImage): void;
}

/**
 * The narrow replica-side seam the reward applier installs onto. A real session
 * adapts its BattleScene into this; the node-pure lane passes a fake that records
 * which verbs fired. NO globalScene / getCoopRuntime read lives behind it.
 */
export interface CoopRewardApplierSurface {
  /** The open watcher mirror for this operationId, or `null`. The committed entry closes it (adopts the image). */
  openWatcherFor(operationId: string): OpenInteractionWatcher<CoopRewardInteractionMaterialV2> | null;
  /** Install the authoritative reward image into engine state. `false` stops the pipeline before materialApplied. */
  installReward(image: CoopRewardInteractionMaterialV2): boolean;
}

/**
 * Build the replica's {@link ApplyMaterialFn} for the reward surface. In stage order
 * (called by the foundation replica pipeline at materialApplied):
 *   1. decode + verify the committed image (digest match);
 *   2. CLOSE any open local watcher for that operationId, adopting the image (the
 *      ordered-apply authority-close - the idle watcher's mirror cannot linger);
 *   3. install the authoritative image; its boolean is the stage's verdict.
 */
export function makeRewardInteractionApplier(surface: CoopRewardApplierSurface): ApplyMaterialFn {
  return (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const image = decodeRewardInteractionMaterial(entry);
    if (image == null) {
      return false;
    }
    closeWatcher(surface.openWatcherFor(entry.operationId), image);
    return surface.installReward(image);
  };
}

// ===========================================================================
// SURFACE 2 - MARKET / SHOP-BUY (atomic apply-or-rollback as typed material).
// ===========================================================================

/** Why a market buy did NOT apply. The authority states the rollback as first-class typed material. */
export type CoopMarketRollbackReason = "insufficient-funds" | "out-of-stock" | "invalid-slot";

/**
 * The ATOMIC outcome of a market buy stated by the authority:
 *   - "applied"     - the buy took effect; `moneyAfter` is the post-buy balance and
 *                     `targetPartySlot` the mon it was applied to (null for a
 *                     party-agnostic item). The replica installs it exactly-once.
 *   - "rolled-back" - the buy did NOT take effect (insufficient funds / stock /
 *                     invalid slot); the replica adopts a no-op. This makes the
 *                     legacy "host never commits an insufficient-funds buy" a
 *                     first-class typed outcome the replica can render.
 */
export type CoopMarketBuyOutcomeV2 =
  | { readonly kind: "applied"; readonly moneyAfter: number; readonly targetPartySlot: number | null }
  | { readonly kind: "rolled-back"; readonly reason: CoopMarketRollbackReason };

/**
 * A market action: a "buy" of `slot` into the streamed stock with an atomic outcome,
 * or a "leave" (the market terminal - legacy slot === -1). Modelled as a union so a
 * leave carries no outcome and a buy always carries its apply/rollback verdict.
 */
export type CoopMarketActionV2 =
  | { readonly kind: "buy"; readonly slot: number; readonly outcome: CoopMarketBuyOutcomeV2 }
  | { readonly kind: "leave" };

/** The authoritative market IMAGE. `terminal` states whether this action closes the market for good. */
export interface CoopMarketInteractionMaterialV2 {
  readonly kind: "market";
  readonly wave: number;
  readonly ownerSeatId: number;
  readonly action: CoopMarketActionV2;
  readonly terminal: boolean;
}

const MARKET_ROLLBACK_REASONS: ReadonlySet<string> = new Set<CoopMarketRollbackReason>([
  "insufficient-funds",
  "out-of-stock",
  "invalid-slot",
]);

/** Whether a value is a well-formed market buy outcome. */
export function isValidMarketBuyOutcome(value: unknown): value is CoopMarketBuyOutcomeV2 {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.kind === "applied") {
    return (
      isSafeNonNegInt(value.moneyAfter) && (value.targetPartySlot === null || isSafeNonNegInt(value.targetPartySlot))
    );
  }
  if (value.kind === "rolled-back") {
    return typeof value.reason === "string" && MARKET_ROLLBACK_REASONS.has(value.reason);
  }
  return false;
}

/** Whether a value is a well-formed market action. */
export function isValidMarketAction(value: unknown): value is CoopMarketActionV2 {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.kind === "buy") {
    return isSafeNonNegInt(value.slot) && isValidMarketBuyOutcome(value.outcome);
  }
  return value.kind === "leave";
}

/** Whether a value is COMPLETE market material. */
export function isValidMarketInteractionMaterial(value: unknown): value is CoopMarketInteractionMaterialV2 {
  return (
    isPlainObject(value)
    && value.kind === "market"
    && isSafeNonNegInt(value.wave)
    && isSafeNonNegInt(value.ownerSeatId)
    && typeof value.terminal === "boolean"
    && isValidMarketAction(value.action)
  );
}

/** Inputs for {@link buildMarketInteractionEntry}. */
export interface BuildMarketInteractionEntryInput {
  readonly context: CoopFrameContextV2;
  readonly operationId?: string;
  readonly address?: CoopInteractionWindowAddress;
  readonly material: CoopMarketInteractionMaterialV2;
  readonly successor: CoopInteractionSuccessor;
  readonly subsumes?: readonly number[];
}

/**
 * Build the ONE authoritative market INTERACTION_COMMIT entry. Throws on malformed
 * input. The atomic apply/rollback verdict rides the typed material; the successor
 * is stated by the authority (another market buy chains via a non-terminal action's
 * successor; a leave states the next wave's COMMAND or a BIOME/REWARD chain).
 */
export function buildMarketInteractionEntry(
  input: BuildMarketInteractionEntryInput,
): Omit<CoopAuthorityEntry, "revision"> {
  if (!isValidMarketInteractionMaterial(input.material)) {
    throw new CoopInteractionBuildError("market material is not complete");
  }
  const operationId = resolveOperationId(input.operationId, input.address, marketOperationId);
  const nextControl = assertInteractionSuccessor(input.successor);
  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: toMaterial(input.material),
    nextControl,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

/** Decode + verify a market entry's material back into a typed image, or `null` on a bad/mismatched entry. */
export function decodeMarketInteractionMaterial(entry: CoopAuthorityEntry): CoopMarketInteractionMaterialV2 | null {
  return decodeInteractionMaterial(entry, "market", isValidMarketInteractionMaterial);
}

/** The narrow replica-side seam the market applier installs onto (watcher-close + install). */
export interface CoopMarketApplierSurface {
  openWatcherFor(operationId: string): OpenInteractionWatcher<CoopMarketInteractionMaterialV2> | null;
  /**
   * Install the authoritative market image. An "applied" buy grants the item + sets
   * money; a "rolled-back" buy and a "leave" install a no-op (adopting the stated
   * outcome). Returns whether it installed - `false` withholds materialApplied.
   */
  installMarket(image: CoopMarketInteractionMaterialV2): boolean;
}

/** Build the replica's {@link ApplyMaterialFn} for the market surface (decode -> watcher-close -> install). */
export function makeMarketInteractionApplier(surface: CoopMarketApplierSurface): ApplyMaterialFn {
  return (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const image = decodeMarketInteractionMaterial(entry);
    if (image == null) {
      return false;
    }
    closeWatcher(surface.openWatcherFor(entry.operationId), image);
    return surface.installMarket(image);
  };
}

// ===========================================================================
// SURFACE 3 - BIOME PICK + CROSSROADS PICK. The destination is STATED in the
// material; the successor is the authority-stated next control (COMMAND next wave,
// or a chained BIOME - the legacy crossroads-LEAVE -> SelectBiomePhase chain).
// ===========================================================================

/**
 * A biome/crossroads selection (the legacy CoopBiomePickPayload / CoopCrossroadsPickPayload):
 *   - "biome-pick"      - the owner picked a destination `biomeId` at `nodeIndex`
 *                         (index into the revealed route nodes; -1 == the
 *                         deterministic single-node / no-picker transition),
 *                         leaving `sourceBiomeId`, advancing to `nextWave`.
 *   - "crossroads-pick" - the owner chose `optionIndex` 0 (Stay) or 1 (Leave). Stay
 *                         resumes the run into the next wave; Leave chains to a
 *                         SelectBiome interaction (the authority states that as a
 *                         BIOME successor).
 */
export type CoopBiomeSelectionV2 =
  | {
      readonly kind: "biome-pick";
      readonly sourceBiomeId: number;
      readonly biomeId: number;
      readonly nodeIndex: number;
      readonly nextWave: number;
    }
  | { readonly kind: "crossroads-pick"; readonly optionIndex: 0 | 1 };

/** The authoritative biome/crossroads IMAGE. The destination lives in `selection`; the owner seat authorizes it. */
export interface CoopBiomeInteractionMaterialV2 {
  readonly kind: "biome";
  readonly wave: number;
  readonly ownerSeatId: number;
  readonly selection: CoopBiomeSelectionV2;
}

/**
 * Whether a selection is well-formed. A biome-pick's `nextWave` MUST be `wave + 1`
 * (the legacy invariant) - passed in so the check is against the material's wave;
 * `nodeIndex >= -1` (−1 is the deterministic transition). A crossroads-pick's
 * `optionIndex` is exactly 0 or 1.
 */
export function isValidBiomeSelection(value: unknown, wave: number): value is CoopBiomeSelectionV2 {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.kind === "biome-pick") {
    return (
      isSafeNonNegInt(value.sourceBiomeId)
      && isSafeNonNegInt(value.biomeId)
      && isSafeInt(value.nodeIndex)
      && (value.nodeIndex as number) >= -1
      && isSafePositiveInt(value.nextWave)
      && (value.nextWave as number) === wave + 1
    );
  }
  if (value.kind === "crossroads-pick") {
    return value.optionIndex === 0 || value.optionIndex === 1;
  }
  return false;
}

/** Whether a value is COMPLETE biome material. */
export function isValidBiomeInteractionMaterial(value: unknown): value is CoopBiomeInteractionMaterialV2 {
  return (
    isPlainObject(value)
    && value.kind === "biome"
    && isSafeNonNegInt(value.wave)
    && isSafeNonNegInt(value.ownerSeatId)
    && isValidBiomeSelection(value.selection, value.wave as number)
  );
}

/** The stable operationId for a biome/crossroads window (disjoint prefix from reward/market). */
export function biomeOperationId(address: CoopBiomeWindowAddress): string {
  const k = address.selection === "crossroads-pick" ? "x" : "b";
  return `IBIO/e${address.epoch}/w${address.wave}/s${address.ownerSeatId}/k${k}`;
}

/** The stable address of one biome/crossroads window. Keyed by the selection kind (the two are disjoint surfaces). */
export interface CoopBiomeWindowAddress {
  readonly epoch: number;
  readonly wave: number;
  readonly ownerSeatId: number;
  readonly selection: "biome-pick" | "crossroads-pick";
}

/** Inputs for {@link buildBiomeInteractionEntry}. */
export interface BuildBiomeInteractionEntryInput {
  readonly context: CoopFrameContextV2;
  readonly operationId?: string;
  readonly address?: CoopBiomeWindowAddress;
  readonly material: CoopBiomeInteractionMaterialV2;
  readonly successor: CoopInteractionSuccessor;
  readonly subsumes?: readonly number[];
}

/**
 * Build the ONE authoritative biome/crossroads INTERACTION_COMMIT entry. Throws on
 * malformed input. The destination is stated in the material; the successor is the
 * authority-stated next control - a COMMAND into the next wave for a biome-pick /
 * crossroads-Stay, or a BIOME chain for a crossroads-Leave (never guest-derived).
 */
export function buildBiomeInteractionEntry(
  input: BuildBiomeInteractionEntryInput,
): Omit<CoopAuthorityEntry, "revision"> {
  if (!isValidBiomeInteractionMaterial(input.material)) {
    throw new CoopInteractionBuildError("biome material is not complete");
  }
  const operationId = resolveOperationId(input.operationId, input.address, biomeOperationId);
  const nextControl = assertInteractionSuccessor(input.successor);
  return {
    context: input.context,
    operationId,
    kind: INTERACTION_COMMIT_KIND,
    material: toMaterial(input.material),
    nextControl,
    subsumes: normalizeSubsumes(input.subsumes),
  };
}

/** Decode + verify a biome entry's material back into a typed image, or `null` on a bad/mismatched entry. */
export function decodeBiomeInteractionMaterial(entry: CoopAuthorityEntry): CoopBiomeInteractionMaterialV2 | null {
  return decodeInteractionMaterial(entry, "biome", isValidBiomeInteractionMaterialGuard);
}

/** The narrow replica-side seam the biome applier installs onto (watcher-close + install). */
export interface CoopBiomeApplierSurface {
  openWatcherFor(operationId: string): OpenInteractionWatcher<CoopBiomeInteractionMaterialV2> | null;
  /** Install the authoritative biome/crossroads image (adopt the destination). `false` withholds materialApplied. */
  installBiome(image: CoopBiomeInteractionMaterialV2): boolean;
}

/** Build the replica's {@link ApplyMaterialFn} for the biome surface (decode -> watcher-close -> install). */
export function makeBiomeInteractionApplier(surface: CoopBiomeApplierSurface): ApplyMaterialFn {
  return (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const image = decodeBiomeInteractionMaterial(entry);
    if (image == null) {
      return false;
    }
    closeWatcher(surface.openWatcherFor(entry.operationId), image);
    return surface.installBiome(image);
  };
}

// ---------------------------------------------------------------------------
// Owner window - the bounded pick deadline (foundation scheduler). A single
// bounded "humanInput" active-time deadline, NOT a retry loop: when it elapses
// without the owner picking, the authority auto-resolves. Owner-addressed so
// teardown / lease release cancels it by owner.
// ---------------------------------------------------------------------------

/**
 * How long the owning seat has to resolve an interaction before the authority
 * auto-resolves. Consumed as "humanInput" ACTIVE time so a suspended tab /
 * disconnect pauses the window instead of burning it (mirrors the faint-replacement
 * owner window).
 */
export const COOP_INTERACTION_OWNER_WINDOW_MS = 60_000;

/** The scheduler time class the owner window consumes (a human is deliberating). */
export const COOP_INTERACTION_OWNER_WINDOW_TIME_CLASS = "humanInput" as const;

/** The addressed timer owner for one interaction window's owner deadline. */
export function interactionOwnerWindowOwner(operationId: string): CoopTimerOwner {
  return {
    ownerId: `authority-v2:interactions-reward:${operationId}`,
    address: `authority-v2/interactions-reward/${operationId}`,
    reason: `owner interaction window for ${operationId}`,
  };
}

/**
 * Arm the owner window on the runtime scheduler (never a raw setTimeout). When
 * {@link COOP_INTERACTION_OWNER_WINDOW_MS} of "humanInput" ACTIVE time elapses
 * without the owner resolving, `onFallback` fires and the authority commits a
 * fallback resolution. The returned handle cancels the window when the owner picks
 * first (the pick + the fallback are mutually exclusive). The timer is
 * owner-addressed, so teardown / lease release cancels it by owner - it is a single
 * bounded deadline, NOT a retry loop.
 */
export function armInteractionOwnerWindow(
  ctx: CoopRuntimeContext,
  operationId: string,
  onFallback: () => void,
): () => void {
  return ctx.scheduler.schedule(
    interactionOwnerWindowOwner(operationId),
    COOP_INTERACTION_OWNER_WINDOW_MS,
    COOP_INTERACTION_OWNER_WINDOW_TIME_CLASS,
    onFallback,
  );
}

// ---------------------------------------------------------------------------
// Shadow-parity seam. A pure, comparable descriptor of a committed (or to-be-
// committed) interaction entry + a comparator, so a dual-run shadow can prove the
// AUTHORITATIVE statement equals what a legacy derivation WOULD have produced.
// Evidence gathering only - it never mutates and is never a second source of truth.
// ---------------------------------------------------------------------------

/**
 * A canonical, comparable descriptor of one interaction entry: its surface, the
 * owner seat, the stated control address, and the material digest. Because the
 * digest is a complete encoding of the typed material, two descriptors are
 * parity-equal IFF the AUTHORITY and the SHADOW agree on the exact resolved
 * interaction + stated successor.
 */
export interface CoopInteractionShadow {
  readonly surface: CoopInteractionSurface;
  readonly operationId: string;
  readonly ownerSeatId: number;
  /** The controlId of the stated successor, or null for a null control. */
  readonly controlId: string | null;
  /** A stable digest of the typed material (byte-identical across clients). */
  readonly materialDigest: string;
}

/**
 * Extract the shadow descriptor from a committed (or to-be-committed) interaction
 * entry. Pure and total over this lane's material: it reads only the entry's own
 * typed material + stated control. Returns `null` when the entry is not a decodable
 * reward / market / biome INTERACTION_COMMIT (e.g. a mystery/learn interaction from
 * another lane, or a foreign entry kind).
 */
export function shadowOfInteractionEntry(
  entry: Omit<CoopAuthorityEntry, "revision"> | CoopAuthorityEntry,
): CoopInteractionShadow | null {
  if (entry.kind !== INTERACTION_COMMIT_KIND) {
    return null;
  }
  const payload = entry.material.payload;
  const surface = interactionSurfaceOf(payload, entry.material.digest);
  if (surface == null) {
    return null;
  }
  const control = entry.nextControl;
  return {
    surface,
    operationId: entry.operationId,
    ownerSeatId: (payload as { ownerSeatId: number }).ownerSeatId,
    controlId: control == null ? null : controlIdOf(control),
    materialDigest: entry.material.digest,
  };
}

/** A parity verdict; a mismatch names the first field that diverged (the evidence). */
export type CoopInteractionParity = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Compare the AUTHORITY's shadow descriptor against a SHADOW observer's descriptor.
 * Equal IFF they agree on the surface, the owner seat, the stated control address,
 * the operationId, and the material digest - i.e. the authoritative statement is
 * exactly what the shadow (derivation) would have produced. A divergence is reported
 * with the offending field so the dual-run harness can fail loud with evidence.
 */
export function checkInteractionParity(
  authority: CoopInteractionShadow,
  shadow: CoopInteractionShadow,
): CoopInteractionParity {
  if (authority.surface !== shadow.surface) {
    return { ok: false, reason: `surface ${authority.surface} != ${shadow.surface}` };
  }
  if (authority.operationId !== shadow.operationId) {
    return { ok: false, reason: `operationId ${authority.operationId} != ${shadow.operationId}` };
  }
  if (authority.ownerSeatId !== shadow.ownerSeatId) {
    return { ok: false, reason: `ownerSeatId ${authority.ownerSeatId} != ${shadow.ownerSeatId}` };
  }
  if (authority.controlId !== shadow.controlId) {
    return { ok: false, reason: `controlId ${authority.controlId} != ${shadow.controlId}` };
  }
  if (authority.materialDigest !== shadow.materialDigest) {
    return { ok: false, reason: `materialDigest ${authority.materialDigest} != ${shadow.materialDigest}` };
  }
  return { ok: true };
}

/** Boolean convenience over {@link checkInteractionParity}. */
export function interactionShadowsAgree(a: CoopInteractionShadow, b: CoopInteractionShadow): boolean {
  return checkInteractionParity(a, b).ok;
}

// ---------------------------------------------------------------------------
// Internals - shared decode / operationId resolution / watcher-close.
// ---------------------------------------------------------------------------

/** Non-generic wrapper so {@link decodeInteractionMaterial} can pass the wave-carrying biome guard. */
function isValidBiomeInteractionMaterialGuard(value: unknown): value is CoopBiomeInteractionMaterialV2 {
  return isValidBiomeInteractionMaterial(value);
}

/**
 * Shared decode + verify: the entry must be an INTERACTION_COMMIT, its payload must
 * be complete material of the expected surface discriminant, and its material digest
 * must match the recomputed digest of that payload (a redelivery can never smuggle a
 * conflicting payload under an admitted revision). Returns the typed image or `null`.
 */
function decodeInteractionMaterial<TImage extends CoopInteractionMaterialV2>(
  entry: CoopAuthorityEntry,
  surface: CoopInteractionSurface,
  isValid: (value: unknown) => value is TImage,
): TImage | null {
  if (entry.kind !== INTERACTION_COMMIT_KIND) {
    return null;
  }
  const payload = entry.material.payload;
  if (!isPlainObject(payload) || payload.kind !== surface || !isValid(payload)) {
    return null;
  }
  if (digestOfInteractionMaterial(payload) !== entry.material.digest) {
    return null;
  }
  return payload;
}

/**
 * Identify which surface a decoded payload belongs to (by discriminant AND digest
 * confirmation), or `null` when it is not this lane's material. The digest check
 * makes the shadow descriptor refuse a payload whose digest disagrees with its
 * contents (a tampered shadow can never claim parity).
 */
function interactionSurfaceOf(payload: unknown, digest: string): CoopInteractionSurface | null {
  if (!isPlainObject(payload)) {
    return null;
  }
  if (payload.kind === "reward" && isValidRewardInteractionMaterial(payload)) {
    return digestOfInteractionMaterial(payload) === digest ? "reward" : null;
  }
  if (payload.kind === "market" && isValidMarketInteractionMaterial(payload)) {
    return digestOfInteractionMaterial(payload) === digest ? "market" : null;
  }
  if (payload.kind === "biome" && isValidBiomeInteractionMaterial(payload)) {
    return digestOfInteractionMaterial(payload) === digest ? "biome" : null;
  }
  return null;
}

/**
 * Resolve an entry's operationId: an explicit `operationId` wins; otherwise it is
 * minted from `address` via `mint`. Throws on a missing/invalid identity (an
 * authority never commits an entry with no wire-safe operation address).
 */
function resolveOperationId<TAddress>(
  explicit: string | undefined,
  address: TAddress | undefined,
  mint: (address: TAddress) => string,
): string {
  const operationId = explicit ?? (address == null ? undefined : mint(address));
  if (!isValidOperationId(operationId)) {
    throw new CoopInteractionBuildError(`invalid or missing operationId ${String(operationId)}`);
  }
  return operationId;
}

/**
 * Close an open watcher by adopting the committed image (the ordered-apply
 * authority-close). A `null` watcher (no local mirror open) is a no-op; `adopt` is
 * contracted idempotent + non-throwing, so a redelivery re-adopts harmlessly.
 */
function closeWatcher<TImage>(watcher: OpenInteractionWatcher<TImage> | null, image: TImage): void {
  if (watcher != null) {
    watcher.adopt(image);
  }
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MYSTERY-ENCOUNTER operation surface (Wave-2c authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §2.5 item 2 + §5.1).
//
// The SECOND production wiring of the authoritative operation model
// (coop-operation-runtime.ts) onto a live control surface: mystery encounters - the
// #859/#860/#862 phantom-turn / wave-type-divergence cluster (§2.1 #8/#9/#10). Cloned
// STRUCTURALLY from coop-biome-operation.ts (the Wave-2a TEMPLATE, §8); the deltas the ME
// surface adds over biome are recorded in the doc's §8 amendments (multi-step ops, the
// host-stated terminal type that makes the #859 phantom structurally impossible).
//
// WHAT IT DOES:
//   - OWNER: mints a TYPED intent (invariant 2) for each ME decision (option pick, sub-pick,
//     button, quiz answer, presentation ack, terminal) and, on the AUTHORITY (coop host),
//     COMMITS it EXACTLY ONCE through CoopOperationHost (invariant 3), advancing a surface-
//     local revision (§1.5).
//   - WATCHER: gates its adoption of the relayed decision through CoopOperationGuest -
//     idempotent by operationId (invariant 5), late-/stale-rejecting a decision from an
//     earlier interaction or a prior epoch (invariant 6, the #861 shape). At the TERMINAL
//     the committed op STATES the ME's outcome/type (leave vs battle) BEFORE the watcher
//     builds phases, so a watcher can never park on a phantom battle chain for a non-battle
//     ME (the #859/#860 phantom-turn class made structurally impossible). P33 makes that terminal a
//     COMPLETE transaction: comprehensive host state + exact battle/continue destination in one retained op.
//
// DUAL-RUN (§1.8, §5.1): this rides ALONGSIDE the legacy ME relay (CoopMePump + the
// presentation and owner-input relays only. ME_TERMINAL is cut over in journal mode: raw meResync,
// ME battle-party, and 9M terminal frames are rollback-only, while the retained terminal is the sole
// DATA+CONTROL authority. Pins/counters remain addressed boundary state; disabling the flag/journal
// selects the legacy carrier.
//
// FLAG (adjudication (b), §5.4): `isCoopMeOperationEnabled()`. Default ON, gated by the
// SAME er-coop-13 protocol-version handshake as biome (COOP_PROTOCOL_VERSION; no new bump -
// no new wire arm; P33 extends the existing ME_TERMINAL payload). Paired
// clients share the version, so a session is either both-envelope or both-legacy, never half.
// The legacy path stays selectable - `setCoopMeOperationEnabled(false)` is the one-line
// per-surface rollback (§5.4). CI/soak force legacy via COOP_ME_OP=off. State is per-session
// and reset on assembleCoopRuntime / clearCoopRuntime.
//
// DESIGN DELTA vs biome (recorded in §8): an ME is a MULTI-STEP operation - one pinned
// interaction counter spans present -> pick -> N sub-picks / quiz answers -> terminal. Biome
// was ONE op per pinned counter, so its operationId suffix was just the wire seq. Here the
// suffix embeds BOTH the wire seq AND a per-kind + per-step discriminator (meOpAddr) so every
// step of the SAME ME mints a DISTINCT id for idempotent dedupe (invariant 5), while the
// cross-ME stale ordering still runs on the pinned counter (which advances once per whole ME).
// =============================================================================

import { canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import { captureCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_CAP_OP_ME, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import { setCoopMeOwnerIntentOrdinals } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopMeButtonPayload,
  type CoopMePickPayload,
  type CoopMePresentPayload,
  type CoopMeSubPayload,
  type CoopMeTerminalDestination,
  type CoopMeTerminalKind,
  type CoopMeTerminalPayload,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopQuizAnswerPayload,
  makeCoopOperationId,
  parseCoopOperationId,
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
  type CoopRuntimeOpState,
  maybeCoopOpSurfaceState,
  registerCoopOpSurfaceState,
  requireCoopOpSurfaceState,
  requireCoopOpSurfaceStateFor,
  resetActiveCoopRuntimeClocks,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { COOP_ME_PUMP_SEQ_BASE, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopInteractionOutcome,
  CoopRole,
} from "#data/elite-redux/coop/coop-transport";

/** First-success latch for the immutable terminal DATA image reused by every journal retry. */
export class CoopMeTerminalOutcomeLatch {
  private retained: Extract<CoopInteractionOutcome, { k: "meResync" }> | undefined;

  public getOrCapture(
    capture: () => Extract<CoopInteractionOutcome, { k: "meResync" }>,
  ): Extract<CoopInteractionOutcome, { k: "meResync" }> {
    if (this.retained == null) {
      this.retained = JSON.parse(JSON.stringify(capture())) as Extract<CoopInteractionOutcome, { k: "meResync" }>;
    }
    return this.retained;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Validate the P33 all-in-one terminal transaction before any scene mutation. A modern transaction must
 * carry the id-addressable authoritative state for both leave and battle destinations; accepting the old
 * split `{battle}` control shape here would recreate the raw-party/terminal race this contract removes.
 */
export function isCompleteCoopMeTerminalPayload(value: unknown): value is CoopMeTerminalPayload {
  if (!isPlainObject(value) || (value.terminal !== "leave" && value.terminal !== "battle")) {
    return false;
  }
  const outcome = value.outcome;
  const destination = value.destination;
  if (
    !isPlainObject(outcome)
    || outcome.k !== "meResync"
    || (outcome.base !== null && !isPlainObject(outcome.base))
    || !Array.isArray(outcome.party)
    || !outcome.party.every(item => typeof item === "string")
    || typeof outcome.meSaveData !== "string"
    || typeof outcome.seed !== "string"
    || typeof outcome.waveSeed !== "string"
    || typeof outcome.dex !== "string"
    || !isPlainObject(outcome.authoritativeState)
    || outcome.authoritativeState.version !== 1
    || !isSafeNonNegativeInteger(outcome.authoritativeState.wave)
    || !isSafeNonNegativeInteger(outcome.authoritativeState.turn)
    || !Array.isArray(outcome.authoritativeState.playerParty)
    || !Array.isArray(outcome.authoritativeState.enemyParty)
    || !isPlainObject(destination)
  ) {
    return false;
  }
  if (value.terminal === "battle") {
    return (
      destination.kind === "battle"
      && isSafeNonNegativeInteger(destination.hostTurn)
      && isSafeNonNegativeInteger(destination.encounterMode)
      && typeof destination.disableSwitch === "boolean"
      && outcome.authoritativeState.enemyParty.length > 0
    );
  }
  return (
    destination.kind === "continue"
    && isSafeNonNegativeInteger(destination.nextWave)
    && typeof destination.selectBiome === "boolean"
  );
}

export type CoopMeTerminalReceiveResult = "executed" | "duplicate" | "retry" | "rejected";

export interface CoopMeTerminalReceiveHooks {
  /** Shadow-atomic comprehensive state apply. False leaves the operation unacknowledged and retriable. */
  readonly applyMaterial: () => boolean;
  /** Open the exact terminal surface. False retains the already-applied DATA and retries only control. */
  readonly executeDestination: () => boolean;
}

export interface CoopMeTerminalReceipt {
  readonly operationId: string;
  readonly pinned: number;
  readonly step: number;
  readonly payload: CoopMeTerminalPayload;
}

interface CoopMeTerminalReceiptState {
  readonly identity: string;
  materialApplied: boolean;
  executed: boolean;
}

interface CoopMeTerminalPinnedState {
  readonly operationId: string;
  readonly terminal: CoopMeTerminalKind;
  readonly step: number;
  executed: boolean;
}

/**
 * Durable ME terminal admission/once gate. DATA and CONTROL have separate progress bits so a late replay
 * phase or hot-rejoin can retry destination execution without reapplying a monotonic state tick. A pinned
 * ME accepts step 0 first, then one monotonically-addressed step after every executed battle. This covers
 * both the ordinary `battle(0) -> leave(1)` path and multi-battle encounters such as Colosseum without a
 * separately timed enemy-party carrier.
 */
export class CoopMeTerminalTransactionReceiver {
  private readonly receipts = new Map<string, CoopMeTerminalReceiptState>();
  private readonly pinned = new Map<number, CoopMeTerminalPinnedState>();

  public reset(): void {
    this.receipts.clear();
    this.pinned.clear();
  }

  public receive(receipt: CoopMeTerminalReceipt, hooks: CoopMeTerminalReceiveHooks): CoopMeTerminalReceiveResult {
    const parsed = parseCoopOperationId(receipt.operationId);
    const expectedAddress = (COOP_ME_TERM_SEQ_BASE + receipt.pinned) * 8000 + 4000 + receipt.step;
    if (
      receipt.operationId.length === 0
      || !isSafeNonNegativeInteger(receipt.pinned)
      || !isSafeNonNegativeInteger(receipt.step)
      || receipt.step >= 1_000
      || parsed?.owner !== 0
      || parsed.kind !== "ME_TERMINAL"
      || parsed.pinnedSeq !== expectedAddress
      || !isCompleteCoopMeTerminalPayload(receipt.payload)
    ) {
      return "rejected";
    }
    const identity = canonicalize({ pinned: receipt.pinned, step: receipt.step, payload: receipt.payload });
    const priorReceipt = this.receipts.get(receipt.operationId);
    if (priorReceipt != null && priorReceipt.identity !== identity) {
      return "rejected";
    }
    if (priorReceipt?.executed) {
      return "duplicate";
    }
    const priorPinned = this.pinned.get(receipt.pinned);
    if (priorReceipt == null) {
      const expectedStep =
        priorPinned == null
          ? 0
          : priorPinned.terminal === "battle" && priorPinned.executed
            ? priorPinned.step + 1
            : null;
      if (expectedStep == null || receipt.step !== expectedStep) {
        return "rejected";
      }
    }
    const receiptState: CoopMeTerminalReceiptState = priorReceipt ?? {
      identity,
      materialApplied: false,
      executed: false,
    };
    if (priorReceipt == null) {
      this.receipts.set(receipt.operationId, receiptState);
      this.pinned.set(receipt.pinned, {
        operationId: receipt.operationId,
        terminal: receipt.payload.terminal,
        step: receipt.step,
        executed: false,
      });
    }
    try {
      if (!receiptState.materialApplied) {
        if (!hooks.applyMaterial()) {
          return "retry";
        }
        receiptState.materialApplied = true;
      }
      if (!hooks.executeDestination()) {
        return "retry";
      }
    } catch {
      return "retry";
    }
    receiptState.executed = true;
    const current = this.pinned.get(receipt.pinned);
    if (current?.operationId === receipt.operationId) {
      current.executed = true;
    }
    return "executed";
  }
}

/** The mystery-encounter operation kinds this surface commits (the §2.1 #8/#9/#10 successors). */
export type CoopMeOperationKind = Extract<
  CoopOperationKind,
  "ME_PRESENT" | "ME_PICK" | "ME_SUB" | "ME_BUTTON" | "ME_TERMINAL" | "QUIZ_ANSWER"
>;

/** Boundary tails sanctioned by the host-stated ME terminal (strict-tail renderer contract). */
export function coopMeTerminalSanctionedTails(
  terminal: CoopMeTerminalKind | CoopMeTerminalPayload | CoopMeTerminalDestination,
): string[] {
  if (typeof terminal !== "string") {
    const destination = "destination" in terminal ? terminal.destination : terminal;
    return destination.kind === "battle"
      ? ["MysteryEncounterBattlePhase", "MysteryEncounterBattleStartCleanupPhase"]
      : destination.selectBiome
        ? ["SelectBiomePhase", "NewBattlePhase"]
        : ["NewBattlePhase"];
  }
  return terminal === "battle"
    ? ["MysteryEncounterBattlePhase", "MysteryEncounterBattleStartCleanupPhase"]
    : ["MysteryEncounterRewardsPhase", "PostMysteryEncounterPhase"];
}

/** The typed per-kind payload the owner mints (invariant 2) / the host commits (invariant 4). */
export type CoopMeOperationPayload =
  | CoopMePresentPayload
  | CoopMePickPayload
  | CoopMeSubPayload
  | CoopMeButtonPayload
  | CoopMeTerminalPayload
  | CoopQuizAnswerPayload;

/** The awaited relay result shape the watcher gates (a subset of CoopInteractionChoice - choice + data). */
export interface CoopMeRelayResult {
  readonly choice: number;
  readonly data?: number[] | undefined;
  readonly operationId?: string | undefined;
}

/** The watcher's adoption verdict for a relayed ME decision. */
export type CoopMeAdoptDecision =
  /** Adopt the relayed decision verbatim. For a terminal op, `terminal` STATES the host's resolution (#859). */
  | {
      readonly adopt: true;
      readonly kind: CoopMeOperationKind;
      readonly terminal?: CoopMeTerminalKind | undefined;
      readonly hostTurn?: number | undefined;
    }
  /** Do NOT adopt (stale / duplicate / rejected / cross-epoch / fail-closed): fall to the deterministic legacy path. */
  | { readonly adopt: false; readonly reason: string };

// -----------------------------------------------------------------------------
// Flag + per-session state (reset on assembleCoopRuntime / clearCoopRuntime).
// -----------------------------------------------------------------------------

/**
 * Default ON. Activation is HARD-GATED by the SAME er-coop-13 protocol-version handshake as biome (the
 * COOP_PROTOCOL_VERSION check): a mixed-build pair refuses to pair / banners, so a live session has both
 * peers on the envelope build. The legacy path remains selectable (rollback = set false). No new wire
 * arm is added, so no new version bump is needed (the ME decision's DATA rides the existing relay).
 */
const DEFAULT_ENABLED = !(typeof process !== "undefined" && process.env?.COOP_ME_OP === "off");

let enabled = DEFAULT_ENABLED;

/** Engine capture seam; focused operation tests can supply a complete Phaser-free authority image. */
export interface CoopMePresentationAuthorityStateHooks {
  readonly capture: (turn: number) => CoopAuthoritativeBattleStateV1 | null;
}

const productionPresentationAuthorityStateHooks: CoopMePresentationAuthorityStateHooks = {
  capture: turn => captureCoopAuthoritativeBattleState(turn),
};
let presentationAuthorityStateHooks = productionPresentationAuthorityStateHooks;

/** Focused-test seam; passing null restores the real atomic engine capture. */
export function setCoopMePresentationAuthorityStateHooksForTest(
  hooks: CoopMePresentationAuthorityStateHooks | null,
): void {
  presentationAuthorityStateHooks = hooks ?? productionPresentationAuthorityStateHooks;
}

/**
 * Every mutable ME operation cursor belongs to one concrete runtime. Production still has one runtime per
 * process; the two-engine harness has two, so a host commit can no longer poison the guest's applied-id cursor,
 * proposal retry set, presentation ordinal, or terminal receipt simply because both clients share one module
 * graph. The rollback flag stays process configuration; all session state lives in this registered record.
 */
interface MeOpState {
  epoch: number;
  revisionFloor: number;
  authorityHost: CoopOperationHost | null;
  watchGuest: CoopOperationGuest | null;
  readonly ownerPresentationSteps: Map<number, number>;
  readonly authoritySubPickSteps: Map<number, number>;
  readonly authorityPickSteps: Map<number, number>;
  readonly retainedTerminalPayloads: Map<string, CoopMeTerminalPayload>;
  lastAppliedPinned: number;
  readonly pendingOwnerIntentRetries: Map<string, ReturnType<typeof setTimeout>>;
  readonly terminalTransactions: CoopMeTerminalTransactionReceiver;
}

registerCoopOpSurfaceState(
  "me",
  (): MeOpState => ({
    epoch: 1,
    revisionFloor: 0,
    authorityHost: null,
    watchGuest: null,
    ownerPresentationSteps: new Map<number, number>(),
    authoritySubPickSteps: new Map<number, number>(),
    authorityPickSteps: new Map<number, number>(),
    retainedTerminalPayloads: new Map<string, CoopMeTerminalPayload>(),
    lastAppliedPinned: -1,
    pendingOwnerIntentRetries: new Map<string, ReturnType<typeof setTimeout>>(),
    terminalTransactions: new CoopMeTerminalTransactionReceiver(),
  }),
);

function state(): MeOpState {
  return requireCoopOpSurfaceState<MeOpState>("me");
}

/** Execute/continue one complete terminal transaction against the receiving runtime's own receipt ledger. */
export function receiveCoopMeTerminalTransaction(
  receipt: CoopMeTerminalReceipt,
  hooks: CoopMeTerminalReceiveHooks,
): CoopMeTerminalReceiveResult {
  return state().terminalTransactions.receive(receipt, hooks);
}

/** Explicit-runtime sibling for durability callbacks that already know the addressed receiving runtime. */
export function receiveCoopMeTerminalTransactionFor(
  opState: CoopRuntimeOpState,
  receipt: CoopMeTerminalReceipt,
  hooks: CoopMeTerminalReceiveHooks,
): CoopMeTerminalReceiveResult {
  return requireCoopOpSurfaceStateFor<MeOpState>(opState, "me").terminalTransactions.receive(receipt, hooks);
}

function isCoopOpRuntimeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("[coop-op]");
}

/** Allocate the next durable ME_PRESENT address step in host emission order. */
export function nextCoopMePresentationStep(pinned: number): number {
  return state().ownerPresentationSteps.get(pinned) ?? 0;
}

/**
 * The highest interaction-counter (pinned) value the local client has already ADOPTED an ME op at AS A
 * WATCHER. Cross-ME stale ordering runs on this (a decision pinned strictly BELOW it is a stale leftover
 * from an earlier interaction, §1.6). Advanced ONLY by a watcher adoption of a TERMINAL - never by the
 * owner's own commit, and never by a mid-ME step (a whole ME shares ONE pinned counter, so the guard must
 * NOT trip between an ME's own present/pick/sub/terminal). -1 = none yet.
 */
/** Guest proposals are not journaled until the host commits them, so retry the legacy relay payload. */
const ME_OWNER_INTENT_RETRY_MS = 1_000;

function cancelOwnerIntentRetry(operationId: string): void {
  const pendingOwnerIntentRetries = state().pendingOwnerIntentRetries;
  const timer = pendingOwnerIntentRetries.get(operationId);
  if (timer != null) {
    clearTimeout(timer);
    pendingOwnerIntentRetries.delete(operationId);
  }
}

/**
 * Retire every still-pending guest proposal after the host's authoritative ME terminal is accepted.
 * A terminal causally proves that the sole host engine consumed every option/sub-pick needed to finish
 * this encounter. Keeping an earlier proposal armed after that point can only inject stale `me`/`meSub`
 * frames into a later encounter; there is never more than one live ME per client.
 */
export function settleCoopMeOwnerIntentRetries(): void {
  const pendingOwnerIntentRetries = state().pendingOwnerIntentRetries;
  if (pendingOwnerIntentRetries.size === 0) {
    return;
  }
  for (const timer of pendingOwnerIntentRetries.values()) {
    clearTimeout(timer);
  }
  coopLog("me", `ME terminal retires ${pendingOwnerIntentRetries.size} completed owner-intent retry timer(s)`);
  pendingOwnerIntentRetries.clear();
}

/** Release the host's first-capture terminal image only after its local close/advance transaction succeeds. */
export function releaseCoopMeRetainedTerminal(operationId: string | null): void {
  if (operationId != null) {
    state().retainedTerminalPayloads.delete(operationId);
  }
}

function armOwnerIntentRetry(operationId: string, resend: () => void): void {
  const pendingOwnerIntentRetries = state().pendingOwnerIntentRetries;
  const existing = pendingOwnerIntentRetries.get(operationId);
  if (existing != null) {
    clearTimeout(existing);
    pendingOwnerIntentRetries.delete(operationId);
  }
  const retry = (): void => {
    if (!pendingOwnerIntentRetries.has(operationId)) {
      return;
    }
    try {
      resend();
    } catch (e) {
      coopWarn("me", `ME owner intent resend threw id=${operationId}; retry remains armed`, e);
    }
    // A loopback/synchronous transport can deliver the committed envelope during `resend()`.
    if (pendingOwnerIntentRetries.has(operationId)) {
      pendingOwnerIntentRetries.set(operationId, setTimeout(retry, ME_OWNER_INTENT_RETRY_MS));
    }
  };
  pendingOwnerIntentRetries.set(operationId, setTimeout(retry, ME_OWNER_INTENT_RETRY_MS));
}

/**
 * True iff the migrated (envelope-gated) ME path is active; else pure legacy fallback (§5.1). The local
 * rollback flag (`enabled`) is the OUTER gate; the NEGOTIATED capability set is the inner one (#896
 * W2e-R2): if the peer did not advertise "opSurface.me", it is not in the intersection and the surface
 * stays OFF on BOTH peers (fail closed). Pre-handshake the capability gate is inert (local flag alone).
 */
export function isCoopMeOperationEnabled(): boolean {
  return enabled && !isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_ME);
}

/** Whether the complete retained ME envelope, rather than the negotiated raw fallback, owns correctness. */
export function isCoopMeOperationJournalActive(): boolean {
  return isCoopMeOperationEnabled() && isCoopOperationJournalActive();
}

/** Select the migrated path (true) or the legacy relay fallback (false). The one-line per-surface rollback (§5.4). */
export function setCoopMeOperationEnabled(value: boolean): void {
  enabled = value;
}

/** Restore the flag to its version-gated default (test hygiene). */
export function resetCoopMeOperationFlag(): void {
  enabled = DEFAULT_ENABLED;
}

/** The current ME operation epoch (§1.4). */
export function getCoopMeOperationEpoch(): number {
  return maybeCoopOpSurfaceState<MeOpState>("me")?.epoch ?? 1;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopMeOperationEpoch(next: number): void {
  const s = maybeCoopOpSurfaceState<MeOpState>("me");
  if (s == null || next === s.epoch) {
    return;
  }
  s.epoch = next;
  resetCoopMeOperationState();
}

/** Tear down the active runtime's per-session operation state. Safe no-op when no runtime is installed. */
export function resetCoopMeOperationState(): void {
  const s = maybeCoopOpSurfaceState<MeOpState>("me");
  if (s == null) {
    return;
  }
  resetActiveCoopRuntimeClocks();
  for (const timer of s.pendingOwnerIntentRetries.values()) {
    clearTimeout(timer);
  }
  s.pendingOwnerIntentRetries.clear();
  s.authorityHost = null;
  s.watchGuest = null;
  s.ownerPresentationSteps.clear();
  s.authoritySubPickSteps.clear();
  s.authorityPickSteps.clear();
  s.retainedTerminalPayloads.clear();
  s.lastAppliedPinned = -1;
  s.revisionFloor = 0;
  s.terminalTransactions.reset();
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:me"]`. Recreates the host +
 * guests so the producer continues at floor+1 and the guests accept it. No-op for a fresh session.
 */
export function setCoopMeOperationRevisionFloor(hw: number): void {
  const s = maybeCoopOpSurfaceState<MeOpState>("me");
  if (s == null || !Number.isFinite(hw) || hw <= 0 || hw === s.revisionFloor) {
    return;
  }
  s.revisionFloor = hw;
  s.authorityHost = null;
  s.watchGuest = null;
}

// -----------------------------------------------------------------------------
// Internals.
// -----------------------------------------------------------------------------

function host(): CoopOperationHost {
  const s = state();
  s.authorityHost ??= CoopOperationHost.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.authorityHost;
}

function guest(): CoopOperationGuest {
  const s = state();
  s.watchGuest ??= CoopOperationGuest.forActiveRuntime({ epoch: s.epoch, initialRevision: s.revisionFloor });
  return s.watchGuest;
}

/**
 * Per-kind discriminator for the operationId suffix (the MULTI-STEP delta over biome, §8). Distinct so an
 * ME_PRESENT and an ME_PICK that ride the same 8M wire seq (present on the OUTCOME inbox, pick on the
 * CHOICE inbox) mint DISTINCT ids for idempotent dedupe (invariant 5).
 */
const ME_KIND_TAG: Record<CoopMeOperationKind, number> = {
  ME_PRESENT: 0,
  ME_PICK: 1,
  ME_SUB: 2,
  ME_BUTTON: 3,
  ME_TERMINAL: 4,
  QUIZ_ANSWER: 5,
};

/**
 * Mint the unique per-STEP operation address (the id suffix). An ME spans multiple decisions on one
 * pinned counter, so the suffix embeds the wire `seq`, the per-kind tag, and a per-step index (the FIFO
 * sub-pick / button ordinal, or the quiz question index) so every step of the SAME ME is a DISTINCT id.
 * All components are bounded well inside Number.MAX_SAFE_INTEGER (seq <= 9.9M, tag < 8, step < 1000).
 */
function meOpAddr(kind: CoopMeOperationKind, seq: number, step: number): number {
  return seq * 8000 + ME_KIND_TAG[kind] * 1000 + (((step % 1000) + 1000) % 1000);
}

/** Project one newly applied owner intent into the reconnect control snapshot. */
export function adoptCoopMeCommittedOwnerOrdinal(op: CoopPendingOperation): boolean {
  if ((op.kind !== "ME_PICK" && op.kind !== "ME_SUB") || op.status !== "applied") {
    return false;
  }
  const parsed = parseCoopOperationId(op.id);
  if (parsed == null || parsed.kind !== op.kind || parsed.owner !== op.owner) {
    return false;
  }
  const seq = Math.floor(parsed.pinnedSeq / 8000);
  const remainder = parsed.pinnedSeq - seq * 8000;
  const step = remainder - ME_KIND_TAG[op.kind] * 1000;
  const pinned = seq - COOP_ME_PUMP_SEQ_BASE;
  if (
    !Number.isSafeInteger(pinned)
    || pinned < 0
    || !Number.isSafeInteger(step)
    || step < 0
    || step > 999
    || meOpAddr(op.kind, seq, step) !== parsed.pinnedSeq
  ) {
    return false;
  }
  setCoopMeOwnerIntentOrdinals(
    pinned,
    op.kind === "ME_PICK" ? step + 1 : undefined,
    op.kind === "ME_SUB" ? step + 1 : undefined,
  );
  return true;
}

/**
 * The owner-parity validator (§1.3): the intent's owner seat MUST be the seat the interaction counter
 * assigns for this pinned slot. The typed successor of `isLocalOwnerAtCounter` - the host refuses an
 * intent from the wrong seat instead of trusting the sender. NOTE: for an ME the presentation ack + the
 * terminal are HOST-driven regardless of who owns the encounter (the host is the sole ME engine, #693),
 * so those kinds validate against the host seat; the owner-alternated pick/sub/button/quiz validate
 * against the pinned owner. Both are passed the correct expected seat by the caller.
 */
function seatValidator(expectedSeat: number): CoopIntentValidator {
  return intent =>
    intent.owner === expectedSeat
      ? { ok: true }
      : { ok: false, reason: `wrong-owner:${intent.owner}!=${expectedSeat}` };
}

/**
 * A minimal envelope context. Non-terminal decisions carry only control; ME_TERMINAL carries its complete
 * DATA image in the typed payload. The embedded authoritativeState stays an operation-order placeholder (it
 * classifies on the CONTROL fields only). The real adopt-by-id state apply is UNCHANGED (§1.2).
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
  return { wave, turn, logicalPhase: "MYSTERY_ENCOUNTER", authoritativeState: placeholder };
}

/** Capture the mechanical image described by the accompanying retained ME presentation. */
function presentationContext(wave: number, turn: number): CoopCommitContext | null {
  const authoritativeState = presentationAuthorityStateHooks.capture(turn);
  if (
    authoritativeState == null
    || authoritativeState.tick <= 0
    || authoritativeState.wave !== wave
    || authoritativeState.turn !== turn
    || authoritativeState.playerParty.length === 0
  ) {
    return null;
  }
  return { wave, turn, logicalPhase: "MYSTERY_ENCOUNTER", authoritativeState };
}

/**
 * Which seat DRIVES an ME decision of `kind` pinned at `pinned`. The presentation ack + the terminal are
 * always HOST-authoritative (the host is the sole ME engine, #693); the alternated pick/sub/button/quiz
 * are owned by the seat the interaction counter assigns for the pinned slot.
 */
function ownerSeatFor(kind: CoopMeOperationKind, pinned: number): number {
  if (kind === "ME_PRESENT" || kind === "ME_TERMINAL") {
    return 0; // the host seat (conventionally 0) - the sole ME engine states presence + the terminal.
  }
  return coopInteractionOwnerSeat(pinned);
}

// -----------------------------------------------------------------------------
// Owner seam (§1.3 propose -> commit).
// -----------------------------------------------------------------------------

export interface CoopMeOwnerCommitParams {
  readonly kind: CoopMeOperationKind;
  /** The wire seq the decision rides (8M pick/present, 8.5M quiz, 9M terminal) - the operationId address root (§2.2). */
  readonly seq: number;
  /** The interaction counter this ME is pinned at (stable for the whole ME, §2.2). */
  readonly pinned: number;
  /** Per-step ordinal within the ME (sub-pick / button ordinal, or quiz question index). Default 0 for once-per-ME kinds. */
  readonly step?: number;
  /** The typed payload (§1.1 discriminated per kind). */
  readonly payload: CoopMeOperationPayload;
  /** The local client's coop role - determines whether it is the authority that COMMITS. */
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
  /** Re-send the identical guest->host relay proposal until its committed envelope confirms receipt. */
  readonly resend?: (() => void) | undefined;
}

/**
 * OWNER: mint + (on the authority) COMMIT the typed ME intent through the operation primitive (§1.3).
 * ADDITIVE + dual-run: the phase / pump / quiz-mirror still fires the legacy relay send; this records the
 * authoritative operation. No-op when the flag is OFF. Never throws (the legacy relay is the fallback).
 */
export function commitMeOwnerIntent(params: CoopMeOwnerCommitParams): string | null {
  if (!isCoopMeOperationEnabled()) {
    return null;
  }
  try {
    const s = state();
    if (params.kind === "ME_TERMINAL" && !isCompleteCoopMeTerminalPayload(params.payload)) {
      coopWarn("me", "ME_TERMINAL commit rejected: terminal transaction is incomplete");
      return null;
    }
    const ownerSeat = ownerSeatFor(params.kind, params.pinned);
    // Fail closed at the operation boundary: a guest may only propose an interaction that the pinned
    // ownership schedule assigns to the guest seat. The host is deliberately exempt because it is the
    // sole authority and commits both its own intents and relayed guest intents. Without this guard a
    // watcher-side UI leak could arm a durable resend for a HOST-owned ME and retransmit the stale pick
    // forever after the host had already advanced to the reward/shop boundary.
    if (params.localRole === "guest" && ownerSeat !== 1) {
      coopWarn(
        "me",
        `ME op OWNER reject wrong local owner kind=${params.kind} pinned=${params.pinned} expectedSeat=${ownerSeat} role=guest`,
      );
      return null;
    }
    const step = params.step ?? 0;
    if (params.localRole === "host" && params.kind === "ME_PRESENT") {
      const expected = s.ownerPresentationSteps.get(params.pinned) ?? 0;
      if (step !== expected) {
        coopWarn("me", `ME_PRESENT step ${step} did not match pinned ${params.pinned} expected ${expected}`);
        return null;
      }
    }
    const addr = meOpAddr(params.kind, params.seq, step);
    const operationId = makeCoopOperationId(s.epoch, ownerSeat, addr, params.kind);
    let payload = params.payload;
    if (params.localRole === "host" && params.kind === "ME_TERMINAL") {
      const retained = s.retainedTerminalPayloads.get(operationId);
      if (retained == null) {
        const exact = JSON.parse(JSON.stringify(params.payload)) as CoopMeTerminalPayload;
        s.retainedTerminalPayloads.set(operationId, exact);
        payload = exact;
      } else {
        payload = retained;
      }
    }
    const intent: CoopPendingOperation = {
      id: operationId,
      kind: params.kind,
      owner: ownerSeat,
      status: "proposed",
      payload,
    };
    // The AUTHORITY (coop host) is the sole committer (invariant 3). When the LOCAL owner is the host, it
    // commits its own intent here; when the owner is the guest, the host commits on adopt (watcher seam).
    if (params.localRole === "host") {
      const context =
        params.kind === "ME_PRESENT"
          ? presentationContext(params.wave, params.turn)
          : controlContext(params.wave, params.turn);
      if (context == null) {
        coopWarn("me", `ME_PRESENT ${intent.id} had no complete authoritative state image`);
        return null;
      }
      const res = host().submit(intent, context, seatValidator(ownerSeat));
      if (res.kind === "committed" || res.kind === "reack") {
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed ME step with the durability journal
        // (resend / reconnect replay). An idempotent re-ACK is journaled again as well: this is the
        // recovery path when the operation commit succeeded but its first journal handoff threw.
        // Rides ALONGSIDE the legacy relay (dual-run); no-op when durability OFF.
        if (!tryJournalCoopCommittedEnvelope(res.envelope)) {
          coopWarn("me", `ME op OWNER ${res.kind} could not be retained id=${intent.id}`);
          return null;
        }
        if (params.kind === "ME_PRESENT") {
          s.ownerPresentationSteps.set(params.pinned, step + 1);
        }
        coopLog(
          "me",
          `ME op OWNER ${res.kind} kind=${params.kind} rev=${res.envelope.revision} id=${intent.id} (Wave-2c)`,
        );
      } else {
        coopWarn(
          "me",
          `ME op OWNER commit non-committed (${res.kind}) id=${intent.id} - authoritative control holds (Wave-2c)`,
        );
        return null;
      }
    } else if (params.resend != null) {
      armOwnerIntentRetry(intent.id, params.resend);
    }
    // NOTE: the owner does NOT advance lastAppliedPinned - that is a WATCHER-only order (see its field
    // doc). The owner knows its own decision; only an adopted RELAY needs the stale-ordering guard.
    return intent.id;
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("me", "ME op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2c)", e);
    return null;
  }
}

export type CoopMeAuthorityIntentResult =
  | { kind: "committed"; operationId: string }
  | { kind: "duplicate" }
  | { kind: "gap" }
  | { kind: "failed" };

export interface CoopMeAuthorityGuestIntentParams {
  readonly kind: "ME_PICK" | "ME_SUB";
  readonly seq: number;
  readonly pinned: number;
  readonly step: number;
  readonly value: number;
  readonly wave: number;
  readonly turn: number;
}

/**
 * Host acceptance seam for guest-owned Mystery intents. The guest carries its stable per-ME ordinal in
 * the legacy proposal's data field; a retransmit below the next expected step is a duplicate, while a gap
 * is malformed. The ordinal advances only after the exact host commit and journal handoff succeed.
 */
export function commitMeAuthorityGuestIntent(params: CoopMeAuthorityGuestIntentParams): CoopMeAuthorityIntentResult {
  const s = state();
  const steps = params.kind === "ME_PICK" ? s.authorityPickSteps : s.authoritySubPickSteps;
  const expected = steps.get(params.pinned) ?? 0;
  if (!Number.isSafeInteger(params.step) || params.step < 0 || params.step > 999) {
    return { kind: "gap" };
  }
  if (params.step < expected) {
    return { kind: "duplicate" };
  }
  if (params.step > expected) {
    return { kind: "gap" };
  }
  const operationId = commitMeOwnerIntent({
    kind: params.kind,
    seq: params.seq,
    pinned: params.pinned,
    step: params.step,
    payload: params.kind === "ME_PICK" ? { optionIndex: params.value } : { value: params.value },
    localRole: "host",
    wave: params.wave,
    turn: params.turn,
  });
  if (operationId == null) {
    return { kind: "failed" };
  }
  steps.set(params.pinned, expected + 1);
  setCoopMeOwnerIntentOrdinals(
    params.pinned,
    params.kind === "ME_PICK" ? expected + 1 : undefined,
    params.kind === "ME_SUB" ? expected + 1 : undefined,
  );
  return { kind: "committed", operationId };
}

/** Commit one host-owned top-level/repeated pick without burning its per-ME ordinal on failure. */
export function commitMeAuthorityLocalPick(params: {
  readonly seq: number;
  readonly pinned: number;
  readonly optionIndex: number;
  readonly wave: number;
  readonly turn: number;
}): string | null {
  const s = state();
  const step = s.authorityPickSteps.get(params.pinned) ?? 0;
  const operationId = commitMeOwnerIntent({
    kind: "ME_PICK",
    seq: params.seq,
    pinned: params.pinned,
    step,
    payload: { optionIndex: params.optionIndex },
    localRole: "host",
    wave: params.wave,
    turn: params.turn,
  });
  if (operationId != null) {
    s.authorityPickSteps.set(params.pinned, step + 1);
    setCoopMeOwnerIntentOrdinals(params.pinned, step + 1);
  }
  return operationId;
}

// -----------------------------------------------------------------------------
// Watcher seam (invariant 5 idempotent apply + invariant 6 late-rejection).
// -----------------------------------------------------------------------------

export interface CoopMeWatcherAdoptParams {
  readonly kind: CoopMeOperationKind;
  readonly seq: number;
  readonly pinned: number;
  readonly step?: number | undefined;
  /** The awaited relay result (null = owner timed out / disconnected -> deterministic legacy fallback). */
  readonly res: CoopMeRelayResult | null;
  /** For an ME_TERMINAL adopt, the host's resolution derived from the relayed sentinel (leave vs battle). */
  readonly terminal?: CoopMeTerminalKind | undefined;
  /** For an ME_TERMINAL battle resolution, the host's aligned battle turn (#822). */
  readonly hostTurn?: number | undefined;
  readonly localRole: CoopRole;
  readonly wave: number;
  readonly turn: number;
}

/**
 * WATCHER: gate the adoption of a relayed ME decision through the operation primitive. When the flag is
 * OFF this is a pass-through (adopt iff the relay landed) - pure legacy behavior. When ON:
 *   - on the AUTHORITY watching a guest-owned decision, VALIDATE + COMMIT the guest's intent (invariant 3);
 *   - gate application idempotently by operationId + the pinned order (invariants 5, 6): a stale decision
 *     from an EARLIER ME, a duplicate re-delivery, or a cross-epoch leftover is REJECTED, never applied
 *     (the #861 shape). At the TERMINAL the returned `terminal` STATES the host's resolution (leave vs
 *     battle) so the watcher routes off the OPERATION, not a leftover battle chain (the #859 guarantee).
 * The caller falls back to the legacy path on a reject. Never throws (a throw -> `adopt:false`).
 */
export function adoptMeWatcherChoice(params: CoopMeWatcherAdoptParams): CoopMeAdoptDecision {
  // Legacy / fallback: adopt iff the relay landed, no operation gating.
  if (!isCoopMeOperationEnabled()) {
    return params.res == null
      ? { adopt: false, reason: "no-relay" }
      : { adopt: true, kind: params.kind, terminal: params.terminal, hostTurn: params.hostTurn };
  }
  if (params.res == null) {
    return { adopt: false, reason: "no-relay" };
  }
  // A P33 terminal is adopted only by the retained envelope's complete DATA+destination sink. Raw 9M
  // remains a negotiated rollback carrier, but while the journal is active it can neither author nor
  // execute a terminal (including an operationId-tagged compatibility wake).
  if (params.kind === "ME_TERMINAL") {
    return isCoopOperationJournalActive()
      ? { adopt: false, reason: "await-authoritative-envelope" }
      : {
          adopt: true,
          kind: params.kind,
          terminal: params.terminal,
          hostTurn: params.hostTurn,
        };
  }
  try {
    const s = state();
    const ownerSeat = ownerSeatFor(params.kind, params.pinned);
    const addr = meOpAddr(params.kind, params.seq, params.step ?? 0);
    const derivedOpId = makeCoopOperationId(s.epoch, ownerSeat, addr, params.kind);
    const relayedOp = params.res.operationId == null ? null : parseCoopOperationId(params.res.operationId);
    const addrBase = meOpAddr(params.kind, params.seq, 0);
    if (
      params.res.operationId != null
      && (relayedOp == null
        || relayedOp.epoch !== s.epoch
        || relayedOp.owner !== ownerSeat
        || relayedOp.pinnedSeq < addrBase
        || relayedOp.pinnedSeq >= addrBase + 1000
        || (params.step !== undefined && relayedOp.pinnedSeq !== addr))
    ) {
      return { adopt: false, reason: "stale-or-duplicate" };
    }
    const opId = params.res.operationId ?? derivedOpId;
    const payload = buildAdoptPayload(params);
    const intent: CoopPendingOperation = { id: opId, kind: params.kind, owner: ownerSeat, status: "proposed", payload };

    // The AUTHORITY (host) is the sole committer: if it is WATCHING a guest-owned decision, commit it now
    // (invariant 3). A rejection (wrong owner) -> do not adopt.
    if (params.localRole === "host") {
      const res = host().submit(intent, controlContext(params.wave, params.turn), seatValidator(ownerSeat));
      if (res.kind === "rejected" || res.kind === "rejected-late") {
        coopWarn("me", `ME op WATCHER(host) commit REJECTED (${res.kind}) id=${opId} -> fallback (Wave-2c)`);
        return { adopt: false, reason: `host-${res.kind}` };
      }
      if (res.kind === "committed" || res.kind === "reack") {
        // COMMIT -> JOURNAL (Wave-2e): the host is the sole committer of a GUEST-owned ME step; journal the
        // authoritative envelope so a cut is healed by the journal, not a bespoke self-heal.
        if (!tryJournalCoopCommittedEnvelope(res.envelope)) {
          return { adopt: false, reason: "host-journal-retention-failed" };
        }
        // The sole authority may apply the intent it just validated at this safe phase seam. The
        // non-authoritative peer remains strictly gated on the committed envelope.
        s.lastAppliedPinned = params.pinned;
        return {
          adopt: true,
          kind: params.kind,
          terminal: params.terminal,
          hostTurn: params.hostTurn,
        };
      }
      return { adopt: false, reason: "host-duplicate" };
    }

    // Stale / duplicate rejection (invariant 6, the #861 shape): a decision pinned STRICTLY BELOW one we
    // already adopted the TERMINAL of (a leftover from an EARLIER ME), or a re-delivery of an already-
    // applied op (same operationId), can NEVER overwrite the live decision. The pinned counter is
    // monotonic across MEs; within one ME every step shares the pinned counter, so the `<` guard never
    // trips between an ME's own steps (it only rejects a decision from a strictly-earlier interaction).
    if (params.pinned < s.lastAppliedPinned) {
      coopWarn(
        "me",
        `ME op WATCHER REJECT stale/dup kind=${params.kind} id=${opId} pinned=${params.pinned} lastApplied=${s.lastAppliedPinned} (Wave-2c)`,
      );
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    if (guest().hasApplied(opId)) {
      coopWarn("me", `ME op WATCHER REJECT duplicate kind=${params.kind} id=${opId} (Wave-2c)`);
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    if (isCoopOperationJournalActive()) {
      return { adopt: false, reason: "await-authoritative-envelope" };
    }

    // Apply through the guest applier (surface-local dense revision; classifies + records the op).
    const appliedOp: CoopPendingOperation = { ...intent, status: "applied" };
    const g = guest();
    const applyRes = g.applyEnvelope({
      version: 1,
      sessionEpoch: s.epoch,
      revision: g.getLastAppliedRevision() + 1,
      wave: params.wave,
      turn: params.turn,
      logicalPhase: "MYSTERY_ENCOUNTER",
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.wave, params.turn).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("me", `ME op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> fallback (Wave-2c)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }
    coopLog("me", `ME op WATCHER adopt kind=${params.kind} choice=${params.res.choice} id=${opId} (Wave-2c)`);
    return { adopt: true, kind: params.kind };
  } catch (e) {
    if (isCoopOpRuntimeError(e)) {
      throw e;
    }
    coopWarn("me", "ME op WATCHER gate threw (handled - deterministic fallback) (Wave-2c)", e);
    return { adopt: false, reason: "threw" };
  }
}

// -----------------------------------------------------------------------------
// Journal replay seam (Wave-2e, §4.2/§4.4): route a resent / reconnect-tail committed envelope INTO the
// idempotent guest applier - NOT around it - so a cut ME step re-applies exactly once by operationId.
// -----------------------------------------------------------------------------

/**
 * Apply a committed ME-step envelope delivered by the durability journal (resend or reconnect tail).
 * Routes into the SAME {@linkcode CoopOperationGuest} the live relay-adopt path uses, so it is idempotent
 * by operationId (invariant 5): a dual-run duplicate (the live relay already adopted it) is a no-op.
 * Returns true iff the step was NEWLY applied. No-op when the surface flag is OFF (pure legacy).
 */
function applyJournaledMeEnvelope(envelope: CoopAuthoritativeEnvelopeV1): CoopApplyOutcome {
  if (!isCoopMeOperationEnabled()) {
    return "rejected";
  }
  const op = envelope.pendingOperation;
  if (op == null || op.status !== "applied") {
    return "rejected";
  }
  // The committed envelope is the authority's receipt. Stop the pre-commit retry even if the live
  // dual-run path already applied this operation and this journal delivery is therefore a duplicate.
  cancelOwnerIntentRetry(op.id);
  const g = guest();
  if (g.hasApplied(op.id)) {
    return "duplicate"; // already converged via the journal (a reconnect resend re-delivery) - ACK, no re-apply.
  }
  if (applyCoopOperationEnvelope(g, "op:me", envelope) !== "applied") {
    return "rejected"; // transient non-applicable (retriable); never a permanent condition (that is a duplicate above).
  }
  adoptCoopMeCommittedOwnerOrdinal(op);
  // Route newly-consumed ME operations into the production live sink. A terminal sink applies its complete
  // retained DATA+destination synchronously before this guest revision can advance/ACK.
  coopLog("me", `ME op JOURNAL apply kind=${op.kind} id=${op.id} rev=${envelope.revision} (Wave-2e/W2e-R)`);
  return "applied";
}

// Register the ME guest applier so the durability manager can route a resent / reconnect-tail `op:me`
// envelope into it (one-way dep: adapter -> journal bridge; runs at import).
registerCoopOperationApplier("op:me", applyJournaledMeEnvelope);

/** Build the typed adopt payload from the relayed result + params, discriminated per kind. */
function buildAdoptPayload(params: CoopMeWatcherAdoptParams): CoopMeOperationPayload {
  const choice = params.res?.choice ?? -1;
  switch (params.kind) {
    case "ME_PRESENT":
      return { present: choice >= 0 } satisfies CoopMePresentPayload;
    case "ME_PICK":
      return { optionIndex: choice } satisfies CoopMePickPayload;
    case "ME_SUB":
      return { value: choice } satisfies CoopMeSubPayload;
    case "ME_BUTTON":
      return { button: choice } satisfies CoopMeButtonPayload;
    case "QUIZ_ANSWER":
      return { questionIndex: params.step ?? 0, choice } satisfies CoopQuizAnswerPayload;
    case "ME_TERMINAL":
      throw new Error("ME_TERMINAL is materialized only from its complete retained transaction");
  }
}

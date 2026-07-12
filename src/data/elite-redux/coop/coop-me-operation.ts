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
// WHAT IT DOES (control plane only - the DATA plane, the host's comprehensive meResync +
// per-turn checkpoint, is untouched):
//   - OWNER: mints a TYPED intent (invariant 2) for each ME decision (option pick, sub-pick,
//     button, quiz answer, presentation ack, terminal) and, on the AUTHORITY (coop host),
//     COMMITS it EXACTLY ONCE through CoopOperationHost (invariant 3), advancing a surface-
//     local revision (§1.5).
//   - WATCHER: gates its adoption of the relayed decision through CoopOperationGuest -
//     idempotent by operationId (invariant 5), late-/stale-rejecting a decision from an
//     earlier interaction or a prior epoch (invariant 6, the #861 shape). At the TERMINAL
//     the committed op STATES the ME's outcome/type (leave vs battle) BEFORE the watcher
//     builds phases, so a watcher can never park on a phantom battle chain for a non-battle
//     ME (the #859/#860 phantom-turn class made structurally impossible).
//
// DUAL-RUN (§1.8, §5.1): this rides ALONGSIDE the legacy ME relay (CoopMePump + the
// CoopReplayMePhase awaits), which the phases keep firing unchanged. The legacy mePresent /
// me / meSub / meBtn / quizAns relays, the ME pins (coopMeInteractionStart /
// coopMeBattleInteractionCounter / coopMeHostPresentation), and the interaction counter stay
// LIVE (removing them is FORBIDDEN until every surface is migrated); this layer is ADDITIVE
// control-plane bookkeeping + a watcher adoption gate. When the flag is OFF the surface
// behaves EXACTLY as before (pure legacy fallback).
//
// FLAG (adjudication (b), §5.4): `isCoopMeOperationEnabled()`. Default ON, gated by the
// SAME er-coop-13 protocol-version handshake as biome (COOP_PROTOCOL_VERSION; no new bump -
// no new wire arm, the ME decision's DATA still rides the existing relay/checkpoint). Paired
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

import { COOP_CAP_OP_ME, isCoopSurfaceCapabilityBlocked } from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopApplyOutcome } from "#data/elite-redux/coop/coop-durability";
import {
  type CoopAuthoritativeEnvelopeV1,
  type CoopMeButtonPayload,
  type CoopMePickPayload,
  type CoopMePresentPayload,
  type CoopMeSubPayload,
  type CoopMeTerminalKind,
  type CoopMeTerminalPayload,
  type CoopOperationKind,
  type CoopPendingOperation,
  type CoopQuizAnswerPayload,
  makeCoopOperationId,
  parseCoopOperationId,
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

/** The mystery-encounter operation kinds this surface commits (the §2.1 #8/#9/#10 successors). */
export type CoopMeOperationKind = Extract<
  CoopOperationKind,
  "ME_PRESENT" | "ME_PICK" | "ME_SUB" | "ME_BUTTON" | "ME_TERMINAL" | "QUIZ_ANSWER"
>;

/** Boundary tails sanctioned by the host-stated ME terminal (strict-tail renderer contract). */
export function coopMeTerminalSanctionedTails(terminal: CoopMeTerminalKind): string[] {
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

/**
 * The session epoch (§1.4). Wave-2c keeps it constant (1) per session and resets the surface state on
 * session boundaries; the full launch/resume epoch mint is a later cross-surface piece (§2.4). An epoch
 * change still bumps it here so a cross-epoch operationId is dropped structurally (invariant 6).
 */
let epoch = 1;

/** The authority (coop host) commit log for ME ops. Lazily created; null until first use / on a non-host. */
let authorityHost: CoopOperationHost | null = null;

/** The watcher applier that gates adoption of a relayed decision. Lazily created; null until first use. */
let watchGuest: CoopOperationGuest | null = null;

/** Host presentation ordinal within the pinned ME (top-level, repeated rounds, then follow-up subprompts). */
let ownerPresentationStep = 0;
/** Authority-side ordinal for guest-owned ME_SUB proposals accepted on the host's FIFO. */
let authoritySubPickStep = 0;

/** Allocate the next durable ME_PRESENT address step in host emission order. */
export function nextCoopMePresentationStep(): number {
  return ownerPresentationStep++;
}

/** Allocate the next authority commit address for a guest-owned ME_SUB proposal. */
export function nextCoopMeAuthoritySubPickStep(): number {
  return authoritySubPickStep++;
}

/** ME interactions whose terminal carrier switched from raw legacy to the durable journal. */
const journalLeadingTerminals = new Set<number>();

/** Journal-consumed terminal operations waiting for the replay phase's safe terminal handler. */
const pendingJournalMaterializations = new Set<string>();

/** Arm a journal-led terminal before its production sink feeds the real 9M waiter. */
export function armCoopMeJournalTerminal(operationId: string, pinned: number): void {
  journalLeadingTerminals.add(pinned);
  pendingJournalMaterializations.add(operationId);
}

/**
 * The highest interaction-counter (pinned) value the local client has already ADOPTED an ME op at AS A
 * WATCHER. Cross-ME stale ordering runs on this (a decision pinned strictly BELOW it is a stale leftover
 * from an earlier interaction, §1.6). Advanced ONLY by a watcher adoption of a TERMINAL - never by the
 * owner's own commit, and never by a mid-ME step (a whole ME shares ONE pinned counter, so the guard must
 * NOT trip between an ME's own present/pick/sub/terminal). -1 = none yet.
 */
let lastAppliedPinned = -1;

/**
 * The surface-local revision FLOOR (W2e-R P0-3): seeded from the persisted per-class high-water on a COLD
 * resume so the producer continues at floor+1 (matching the restored durability receiver), keeping the
 * committed-op revision stream monotonic across the save boundary. See the biome adapter for the rationale.
 */
let revisionFloor = 0;

/** Guest proposals are not journaled until the host commits them, so retry the legacy relay payload. */
const ME_OWNER_INTENT_RETRY_MS = 1_000;
const pendingOwnerIntentRetries = new Map<string, ReturnType<typeof setTimeout>>();

function cancelOwnerIntentRetry(operationId: string): void {
  const timer = pendingOwnerIntentRetries.get(operationId);
  if (timer != null) {
    clearTimeout(timer);
    pendingOwnerIntentRetries.delete(operationId);
  }
}

function armOwnerIntentRetry(operationId: string, resend: () => void): void {
  cancelOwnerIntentRetry(operationId);
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
  return epoch;
}

/**
 * Set the operation epoch (§1.4). A CHANGE resets the per-session op state so a leftover operationId from a
 * prior epoch can never satisfy a live op (invariant 6). Idempotent for the same epoch.
 */
export function setCoopMeOperationEpoch(next: number): void {
  if (next === epoch) {
    return;
  }
  epoch = next;
  resetCoopMeOperationState();
}

/** Tear down all per-session operation state (called from assembleCoopRuntime + clearCoopRuntime + tests). Keeps the flag. */
export function resetCoopMeOperationState(): void {
  CoopOperationHost.resetGlobalOrder();
  for (const timer of pendingOwnerIntentRetries.values()) {
    clearTimeout(timer);
  }
  pendingOwnerIntentRetries.clear();
  authorityHost = null;
  watchGuest = null;
  journalLeadingTerminals.clear();
  pendingJournalMaterializations.clear();
  ownerPresentationStep = 0;
  authoritySubPickStep = 0;
  lastAppliedPinned = -1;
  revisionFloor = 0;
}

/**
 * Seed the surface-local revision FLOOR from the persisted per-class high-water on a COLD resume (W2e-R
 * P0-3). Called from `applyCoopControlPlaneSaveData` with `journalHighWater["op:me"]`. Recreates the host +
 * guests so the producer continues at floor+1 and the guests accept it. No-op for a fresh session.
 */
export function setCoopMeOperationRevisionFloor(hw: number): void {
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
 * A minimal control-plane commit context. Wave-2c's ME decision carries no NEW data-plane payload over the
 * wire (the party/save/RNG/dex travels on the existing comprehensive meResync + per-turn checkpoint,
 * dual-run), so the embedded authoritativeState is a lightweight placeholder the applier never reads (it
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
    const addr = meOpAddr(params.kind, params.seq, params.step ?? 0);
    const intent: CoopPendingOperation = {
      id: makeCoopOperationId(epoch, ownerSeat, addr),
      kind: params.kind,
      owner: ownerSeat,
      status: "proposed",
      payload: params.payload,
    };
    // The AUTHORITY (coop host) is the sole committer (invariant 3). When the LOCAL owner is the host, it
    // commits its own intent here; when the owner is the guest, the host commits on adopt (watcher seam).
    if (params.localRole === "host") {
      const res = host().submit(intent, controlContext(params.wave, params.turn), seatValidator(ownerSeat));
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e, §4.1/§4.2): register the committed ME step with the durability journal
        // (resend / reconnect replay). Rides ALONGSIDE the legacy relay (dual-run); no-op when durability OFF.
        journalCoopCommittedEnvelope(res.envelope);
        coopLog("me", `ME op OWNER commit kind=${params.kind} rev=${res.envelope.revision} id=${intent.id} (Wave-2c)`);
      } else {
        coopWarn(
          "me",
          `ME op OWNER commit non-committed (${res.kind}) id=${intent.id} - legacy relay carries it (Wave-2c)`,
        );
      }
    } else if (params.resend != null) {
      armOwnerIntentRetry(intent.id, params.resend);
    }
    // NOTE: the owner does NOT advance lastAppliedPinned - that is a WATCHER-only order (see its field
    // doc). The owner knows its own decision; only an adopted RELAY needs the stale-ordering guard.
    return intent.id;
  } catch (e) {
    coopWarn("me", "ME op OWNER commit threw (handled - legacy relay is the fallback) (Wave-2c)", e);
    return null;
  }
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
  try {
    const ownerSeat = ownerSeatFor(params.kind, params.pinned);
    const addr = meOpAddr(params.kind, params.seq, params.step ?? 0);
    const derivedOpId = makeCoopOperationId(epoch, ownerSeat, addr);
    const relayedOp = params.res.operationId == null ? null : parseCoopOperationId(params.res.operationId);
    const addrBase = meOpAddr(params.kind, params.seq, 0);
    if (
      params.res.operationId != null
      && (relayedOp == null
        || relayedOp.epoch !== epoch
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
      if (res.kind === "committed") {
        // COMMIT -> JOURNAL (Wave-2e): the host is the sole committer of a GUEST-owned ME step; journal the
        // authoritative envelope so a cut is healed by the journal, not a bespoke self-heal.
        journalCoopCommittedEnvelope(res.envelope);
      }
    }

    // Stale / duplicate rejection (invariant 6, the #861 shape): a decision pinned STRICTLY BELOW one we
    // already adopted the TERMINAL of (a leftover from an EARLIER ME), or a re-delivery of an already-
    // applied op (same operationId), can NEVER overwrite the live decision. The pinned counter is
    // monotonic across MEs; within one ME every step shares the pinned counter, so the `<` guard never
    // trips between an ME's own steps (it only rejects a decision from a strictly-earlier interaction).
    if (params.pinned < lastAppliedPinned) {
      coopWarn(
        "me",
        `ME op WATCHER REJECT stale/dup kind=${params.kind} id=${opId} pinned=${params.pinned} lastApplied=${lastAppliedPinned} (Wave-2c)`,
      );
      return { adopt: false, reason: "stale-or-duplicate" };
    }

    if (params.kind === "ME_TERMINAL" && journalLeadingTerminals.has(params.pinned) && relayedOp == null) {
      return { adopt: false, reason: "await-journal" };
    }

    if (guest().hasApplied(opId)) {
      if (params.kind === "ME_TERMINAL" && relayedOp != null && pendingJournalMaterializations.delete(opId)) {
        lastAppliedPinned = params.pinned;
        return {
          adopt: true,
          kind: params.kind,
          terminal: params.terminal,
          hostTurn: params.hostTurn,
        };
      }
      coopWarn("me", `ME op WATCHER REJECT duplicate kind=${params.kind} id=${opId} (Wave-2c)`);
      return { adopt: false, reason: "stale-or-duplicate" };
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
      logicalPhase: "MYSTERY_ENCOUNTER",
      pendingOperation: appliedOp,
      authoritativeState: controlContext(params.wave, params.turn).authoritativeState,
    });
    if (applyRes.kind !== "applied") {
      coopWarn("me", `ME op WATCHER guest non-applied (${applyRes.kind}) id=${opId} -> fallback (Wave-2c)`);
      return { adopt: false, reason: `guest-${applyRes.kind}` };
    }
    // Advance the cross-ME stale order ONLY at the TERMINAL (the whole ME resolved past this pinned
    // counter). A mid-ME step must NOT advance it, or a later same-ME step at the same pinned would be
    // falsely rejected as stale (they share the pinned counter).
    if (params.kind === "ME_TERMINAL") {
      lastAppliedPinned = params.pinned;
    }
    const terminal = params.kind === "ME_TERMINAL" ? params.terminal : undefined;
    coopLog(
      "me",
      `ME op WATCHER adopt kind=${params.kind} choice=${params.res.choice} terminal=${terminal ?? "-"} id=${opId} (Wave-2c)`,
    );
    return { adopt: true, kind: params.kind, terminal, hostTurn: params.hostTurn };
  } catch (e) {
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
  if (!routeCoopOperationToLiveSink("op:me", envelope)) {
    return "rejected";
  }
  const res = g.applyEnvelope({
    ...envelope,
    sessionEpoch: epoch,
    revision: g.getLastAppliedRevision() + 1,
  });
  if (res.kind !== "applied") {
    return "rejected"; // transient non-applicable (retriable); never a permanent condition (that is a duplicate above).
  }
  // Route newly-consumed ME operations into the production live sink. Supported terminal operations feed
  // the tagged host-stated sentinel into the existing 9M safe terminal handler.
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
      return {
        terminal: params.terminal ?? "leave",
        ...(params.hostTurn === undefined ? {} : { hostTurn: params.hostTurn }),
      } satisfies CoopMeTerminalPayload;
  }
}

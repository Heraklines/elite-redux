/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op ALTERNATING-INTERACTION relay (#633). The owner->watcher channel for the
// reward shop / biome shop / mystery-encounter screens.
//
// Same seed -> both clients independently generate the IDENTICAL option pool, so we
// never send the contents. We send only the OWNER's CHOICE (an index into that pool,
// or a sentinel); the WATCHER applies the same index to its own identical pool for
// the identical outcome (same item, same money spent, same ME branch). This is the
// lockstep-input model that fixed the battle command relay, applied to interactions.
//
// Multi-pick screens (a shop where the owner buys several things, then leaves) stream
// a SEQUENCE of choices for one interaction `seq`, ending in a leave sentinel - so
// the relay is FIFO PER seq (NOT latest-wins like the per-turn battle stream): the
// watcher pulls them in order. A choice that arrives before its waiter is buffered;
// a waiter that times out resolves null (the watcher then leaves, never hangs). A
// choice for a stale/old `seq` is buffered harmlessly and never consumed.
//
// Engine-FREE (transport + wire types only) so it is unit-testable headlessly over a
// LoopbackTransport, exactly like CoopBattleStreamer.
// =============================================================================

import { isCoopV2ShadowActive, tapCoopV2ShadowInteractionChoice } from "#data/elite-redux/coop/authority-v2/shadow";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { setCoopMeActivePresentation } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH,
  COOP_ME_REWARD_SURFACE_LIMIT,
} from "#data/elite-redux/coop/coop-operation-envelope";
// #840: seq bands now live in the single-source-of-truth registry; re-exported below under their
// historical names so no call site changes (pure re-export, zero behavior change).
import {
  COOP_BARGAIN_SEQ_BASE,
  COOP_BIOME_SHOP_SEQ_BASE,
  COOP_CATCH_FULL_SEQ,
  COOP_DEX_SYNC_SEQ,
  COOP_FAINT_SWITCH_SEQ_BASE,
  COOP_REVIVAL_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
// #829 malicious-peer hardening: the fixed 2-player seat map (pure, engine-free) resolves which role
// OWNS a field slot, so a forged cross-owner faint-replacement pick can be dropped WITHOUT consulting
// the engine - keeping the relay fully unit-testable headlessly (coop-session imports no game engine).
import { coopOwnerOfFieldIndex } from "#data/elite-redux/coop/coop-session";
import type {
  CoopInteractionOutcome,
  CoopMessage,
  CoopRewardSurfaceIdentity,
  CoopRole,
  CoopSerializedRewardOption,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";
import { recordCoopUiRelayCarrier } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { recordReplayInteraction } from "#data/elite-redux/replay-recorder";

export {
  COOP_BARGAIN_SEQ_BASE,
  COOP_BIOME_SHOP_SEQ_BASE,
  COOP_CATCH_FULL_SEQ,
  COOP_DEX_SYNC_SEQ,
  COOP_FAINT_SWITCH_SEQ_BASE,
  COOP_REVIVAL_SEQ_BASE,
};

/** Sentinel choices shared across interaction screens. */
export const COOP_INTERACTION_LEAVE = -1;

/**
 * #829: the faint-replacement seq band is `COOP_FAINT_SWITCH_SEQ_BASE + fieldIndex` (the audit's 0-3
 * offset). This is the ONE interactionChoice channel where the addressed slot's owner is well-defined
 * (a fixed field seat), so it is the only band the malicious-peer owner check gates on.
 */
const COOP_FAINT_SWITCH_SLOT_COUNT = 4;

/** Keep legacy reward keys byte-identical when no ordered ME surface address exists. */
const COOP_REWARD_SURFACE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

function isWireRewardSurfaceIdentity(value: unknown): value is CoopRewardSurfaceIdentity {
  return (
    value != null
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isSafeInteger((value as CoopRewardSurfaceIdentity).ordinal)
    && (value as CoopRewardSurfaceIdentity).ordinal >= 0
    && (value as CoopRewardSurfaceIdentity).ordinal < COOP_ME_REWARD_SURFACE_LIMIT
    && typeof (value as CoopRewardSurfaceIdentity).surfaceId === "string"
    && (value as CoopRewardSurfaceIdentity).surfaceId.length <= COOP_ME_REWARD_SURFACE_ID_MAX_LENGTH
    && COOP_REWARD_SURFACE_ID_PATTERN.test((value as CoopRewardSurfaceIdentity).surfaceId)
  );
}

function rewardSurfaceKey(rewardSurface?: CoopRewardSurfaceIdentity): string {
  return rewardSurface == null ? "ambient" : `${rewardSurface.ordinal}:${encodeURIComponent(rewardSurface.surfaceId)}`;
}

function rewardOptionsKey(seq: number, reroll: number, rewardSurface?: CoopRewardSurfaceIdentity): string {
  return rewardSurface == null ? `${seq}:${reroll}` : `${seq}:${reroll}:${rewardSurfaceKey(rewardSurface)}`;
}

/** Decode an internally canonical reward-options inbox key without accepting a malformed surface address. */
export function parseCoopRewardOptionsKey(
  key: string,
): { seq: number; reroll: number; rewardSurface?: CoopRewardSurfaceIdentity } | null {
  const [seqText, rerollText, ordinalText, ...surfaceParts] = key.split(":");
  const seq = Number(seqText);
  const reroll = Number(rerollText);
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(reroll)) {
    return null;
  }
  if (ordinalText == null) {
    return { seq, reroll };
  }
  const ordinal = Number(ordinalText);
  const encodedSurfaceId = surfaceParts.join(":");
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || encodedSurfaceId.length === 0) {
    return null;
  }
  try {
    const rewardSurface = { ordinal, surfaceId: decodeURIComponent(encodedSurfaceId) };
    return isWireRewardSurfaceIdentity(rewardSurface) ? { seq, reroll, rewardSurface } : null;
  } catch {
    return null;
  }
}

/**
 * Whether `seq` addresses a faint-REPLACEMENT pick (the `COOP_FAINT_SWITCH_SEQ_BASE + fieldIndex` band).
 * Shared by BOTH co-op (the host's authoritative {@linkcode SwitchPhase} branch #786) and showdown-versus
 * (the host's {@linkcode ShowdownEnemyFaintSwitchPhase}) - both await the guest's HUMAN replacement choice
 * under this same band. A pending pick on this band must SURVIVE a resync rescue: a stateSync snapshot never
 * invalidates a replacement the human is still choosing (dropping it makes the host insta-AI-pick, killing
 * the human's real pick). Only a genuine partner DISCONNECT cancels this band. Used by the resync-rescue
 * cancellation predicates to spare it while still cancelling every other (reward/shop/ME/revival) wait.
 */
export function isCoopFaintSwitchSeq(seq: number): boolean {
  const slot = seq - COOP_FAINT_SWITCH_SEQ_BASE;
  return slot >= 0 && slot < COOP_FAINT_SWITCH_SLOT_COUNT;
}

/** Production carrier seam for an owner-resolved faint replacement (including the no-pick sentinel). */
export function sendCoopFaintSwitchChoice(
  relay: CoopInteractionRelay | null,
  fieldIndex: number,
  partySlot: number,
  data: number[],
): void {
  relay?.sendInteractionChoice(COOP_FAINT_SWITCH_SEQ_BASE + fieldIndex, "switch", partySlot, [...data]);
}

/** Production carrier seam for a Revival Blessing owner's target decision. */
export function sendCoopRevivalChoice(
  relay: CoopInteractionRelay | null,
  fieldIndex: number,
  partySlot: number,
  data: number[],
): void {
  relay?.sendInteractionChoice(COOP_REVIVAL_SEQ_BASE + fieldIndex, "revival", partySlot, [...data]);
}

/**
 * #806 STALL-WATCHDOG SUPPRESSION (faint-replacement window). While a faint-replacement pick is pending -
 * the host AWAITING the partner's relayed choice ({@linkcode ShowdownEnemyFaintSwitchPhase} / the co-op
 * {@linkcode SwitchPhase} #786 branch) OR the guest's own picker OPEN ({@linkcode CoopGuestFaintSwitchPhase})
 * - a slow-but-alive HUMAN legitimately parks BOTH engines in network waits (the host on the relay pick, the
 * guest's replay on the next turn), which the mutual-wait watchdog would misread as a deadlock ~20s in and
 * "recover" by cancelling the pick + pulling a stateSync (the live guest-vs-faint jank). This is the same
 * exemption the reward shop gets for free (its OWNER is in UI, not a network wait); the faint window needs it
 * explicit because BOTH sides ARE in network waits. Registered on BOTH roles; a counter (not a bool) so
 * concurrent double-faint windows nest safely. The bounding faint-switch wait ({@linkcode getCoopFaintSwitchWaitMs})
 * still fires its own timeout, so a genuinely-dead partner is never masked - the watchdog just stops
 * false-firing during a live human's deliberation.
 */
let coopFaintSwitchWindowDepth = 0;

/** Register that a faint-replacement pick window has OPENED on this client (host await or guest picker). */
export function beginCoopFaintSwitchWindow(): void {
  coopFaintSwitchWindowDepth++;
}

/** Register that a faint-replacement pick window has CLOSED on this client. Clamped at 0 (never negative). */
export function endCoopFaintSwitchWindow(): void {
  coopFaintSwitchWindowDepth = Math.max(0, coopFaintSwitchWindowDepth - 1);
}

/** Whether ANY faint-replacement pick window is currently open on this client (the watchdog suppression gate). */
export function isCoopFaintSwitchWindowOpen(): boolean {
  return coopFaintSwitchWindowDepth > 0;
}

/** Reset the faint-switch window depth (test cleanup + hard session teardown - never leak a suppression pin). */
export function resetCoopFaintSwitchWindows(): void {
  coopFaintSwitchWindowDepth = 0;
}

// #673 biome market / #794 dex sync / #795 bargain seq bases are declared in coop-seq-registry
// and re-exported above.
export function coopBiomeShopSeq(pinnedStart: number): number {
  return COOP_BIOME_SHOP_SEQ_BASE + Math.max(0, pinnedStart);
}
export const COOP_BIOME_STOCK_REROLL = 777;
/** Watcher-side wait for the owner's market activity (long, like the reward shop's). */
export const COOP_BIOME_WAIT_MS = 1_200_000;
export const COOP_INTERACTION_REROLL = -2;

/** One relayed owner choice the watcher applies to its identical pool. */
export interface CoopInteractionChoice {
  /** Picked option index, or a sentinel (COOP_INTERACTION_LEAVE / _REROLL). */
  choice: number;
  /** Optional extra indices (party-target slot, ME sub-option); undefined when none. */
  data: number[] | undefined;
  /**
   * #861: the wire `kind` this choice was sent with (reward / me / switch / ...). Carried through so the
   * KIND-VALIDATION on {@linkcode CoopInteractionRelay.awaitInteractionChoice} can re-buffer (never resolve
   * on) a stale/cross-family choice that landed at a REUSED seq. Always set for messages received off the
   * wire; may be undefined for a synthetic choice.
   */
  kind?: string;
  /** Local-only durable carrier correlation. Never serialized on the legacy interactionChoice wire arm. */
  operationId?: string | undefined;
  /** Ordered retained Mystery reward surface carried by reward actions. */
  rewardSurface?: CoopRewardSurfaceIdentity | undefined;
}

/** Options for {@linkcode CoopInteractionRelay} (timer injection for tests). */
export interface CoopInteractionRelayOptions {
  /** How long the watcher waits for the owner's next choice before giving up. Default 180s. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
  /**
   * Showdown 1v1 (versus faint-replacement): live predicate for "this is a VERSUS session". The
   * #829 forged-cross-owner-switch check keys off the fixed 2-player CO-OP seat map (slot 0 -> host,
   * slot 1 -> guest), which does NOT hold in versus - there the guest owns the WHOLE enemy side and
   * legitimately relays faint-replacement picks for the host's enemy field slots (whose seat-map owner
   * is "host"). So in versus the seat-map forgery check is disabled (the picks are validated for
   * legality by the awaiting host phase instead). Injected as a predicate so the relay stays
   * engine-free (the runtime wires `() => controller.isVersusSession()`, live-correct even for the
   * guest, whose kind flips from "coop" to "versus" only on `runConfig` receipt). Defaults to co-op.
   */
  isVersus?: () => boolean;
  /**
   * Resolve the current owner of a player field slot. Production injects the live mon-tag resolver,
   * because party compaction/recentering can move the guest's survivor from slot 1 to slot 0. The
   * engine-free fixed launch map remains the default for relay-only tests.
   */
  resolveFieldSlotOwner?: (fieldIndex: number) => CoopRole;
  /** Authority V2 recovery fence; buffered results remain consumable, but no new wire wait may be armed. */
  isAuthorityWaitCreationFrozen?: () => boolean;
}

// The owner is a human shopping / reading an ME, so the watcher's wait must comfortably
// exceed human deliberation - a premature timeout makes the watcher LEAVE while the owner
// is still deciding (desync). 20min effectively means "wait for the human"; a timeout is
// then only a genuinely-disconnected-partner safety net, not a deliberation timer.
const DEFAULT_TIMEOUT_MS = 1_200_000;
/** Choice kinds whose dual raw+journal carriers have an explicit payload-identity regression. */
const COOP_DURABLE_CHOICE_ECHO_KINDS: ReadonlySet<string> = new Set(["abilityPicker", "learnMoveBatch", "stormglass"]);

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/** Compact, log-safe one-line summary of a relayed choice (never dumps a blob). */
function summarizeChoice(c: CoopInteractionChoice): string {
  return `kind=${c.kind ?? "?"} choice=${c.choice} data=${c.data === undefined ? "-" : `[${c.data.join(",")}]`}`;
}

/**
 * #861: whether a received/buffered choice `kind` is one the awaiting site declared it consumes. A site that
 * passes NO `expectedKinds` (or an empty set) opts out of validation entirely (legacy behavior - accept any),
 * so an un-migrated call site and the primitive relay tests are byte-for-byte unaffected. When a set IS
 * declared, an undefined kind (a synthetic choice with no wire kind) is rejected so it can never masquerade
 * as a legitimate pick.
 */
function kindAccepted(kind: string | undefined, expectedKinds: readonly string[] | undefined): boolean {
  if (expectedKinds === undefined || expectedKinds.length === 0) {
    return true;
  }
  return kind !== undefined && expectedKinds.includes(kind);
}

/**
 * Ordered Mystery surfaces deliberately share one interaction pin and reward kind. `undefined` opts out
 * (legacy callers); `null` means the ambient reward stream; an identity requires an exact semantic match.
 */
function rewardSurfaceAccepted(
  rewardSurface: CoopRewardSurfaceIdentity | undefined,
  expectedRewardSurface: CoopRewardSurfaceIdentity | null | undefined,
): boolean {
  if (expectedRewardSurface === undefined) {
    return true;
  }
  if (expectedRewardSurface === null) {
    return rewardSurface === undefined;
  }
  return rewardSurfaceKey(rewardSurface) === rewardSurfaceKey(expectedRewardSurface);
}

/** #861: an in-flight {@linkcode CoopInteractionRelay.awaitInteractionChoice} waiter + its declared kinds. */
interface CoopChoiceWaiter {
  /** Resolve the parked await (a matching choice, or null on timeout/supersede). */
  readonly finish: (res: CoopInteractionChoice | null) => void;
  /** The kinds this await legitimately consumes; undefined = validation opted out (accept any). */
  readonly expectedKinds: readonly string[] | undefined;
  /** Exact ordered Mystery surface, null for ambient, undefined when surface validation is not requested. */
  readonly expectedRewardSurface: CoopRewardSurfaceIdentity | null | undefined;
}

/** Compact, log-safe one-line summary of a host-resolved interaction outcome (discriminated by `k`). */
function summarizeOutcome(o: CoopInteractionOutcome): string {
  switch (o.k) {
    case "rewardGrant":
      return `k=rewardGrant id=${o.modifierTypeId} slot=${o.partySlot} money=${o.moneyDelta} args=${o.args.length}`;
    case "reroll":
      return `k=reroll money=${o.moneyDelta}`;
    case "leave":
      return "k=leave";
    case "mePresent":
      return `k=mePresent opts=${o.meetsReqs.length}${o.subPrompt ? ` +subPrompt(${o.subPrompt.kind})` : ""}`;
    default:
      return `k=${(o as { k?: string }).k ?? "?"}`;
  }
}

/**
 * Rides a {@linkcode CoopTransport} to relay alternating-interaction choices. One
 * instance per client. The OWNER calls {@linkcode sendInteractionChoice} per pick;
 * the WATCHER `await`s {@linkcode awaitInteractionChoice} in a loop until a leave
 * sentinel.
 */
/**
 * How long the HOST waits for the guest's own-replacement pick (#786) before auto-picking.
 * Injectable so tests never sit through the live-generous default.
 */
let coopFaintSwitchWaitMs = 60_000;

// Seq namespace for guest-owned faint-replacement picks (#786): `BASE + fieldIndex`, shared
// verbatim by the guest picker and the host's awaiting SwitchPhase (deliberately NOT keyed by
// turn). #786 faint-switch (90k) / #809 revival (95k) seq bases are declared in
// coop-seq-registry and re-exported above.

/** #788: how long the HOST defers the next wave's party sync waiting for the partner's menu-done broadcast. */
let coopWaveBarrierMs = 60_000;

export function getCoopWaveBarrierMs(): number {
  return coopWaveBarrierMs;
}

export function setCoopWaveBarrierMs(ms: number): void {
  coopWaveBarrierMs = ms;
}

export function getCoopFaintSwitchWaitMs(): number {
  return coopFaintSwitchWaitMs;
}

export function setCoopFaintSwitchWaitMs(ms: number): void {
  coopFaintSwitchWaitMs = ms;
}

export class CoopInteractionRelay {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly isVersus: () => boolean;
  private readonly resolveFieldSlotOwner: (fieldIndex: number) => CoopRole;
  private readonly isAuthorityWaitCreationFrozen: () => boolean;
  private readonly offMessage: () => void;
  private readonly offState: () => void;
  /** Raw outcomes awaiting their matching journal carrier; keyed by seq + exact JSON payload. */
  private readonly rawOutcomeCredits = new Map<string, number>();
  /** Journal outcomes awaiting a later raw legacy echo, which must be dropped rather than double-applied. */
  private readonly committedOutcomeCredits = new Map<string, number>();
  /** Raw choices awaiting a same-delivery-turn journal carrier; keyed by seq + kind + exact payload. */
  private readonly rawChoiceCredits = new Map<string, number>();
  /** Journal choices awaiting a later raw legacy echo, which must be dropped rather than double-applied. */
  private readonly committedChoiceCredits = new Map<string, number>();
  /** Raw/journal prompt echo credits, keyed by the prompt operation id. */
  private readonly rawRevivalPromptCredits = new Map<string, number>();
  private readonly committedRevivalPromptCredits = new Map<string, number>();
  /** Raw/journal wild catch-full prompt echo credits, keyed by the prompt operation id. */
  private readonly rawCatchFullPromptCredits = new Map<string, number>();
  private readonly committedCatchFullPromptCredits = new Map<string, number>();

  /** seq -> FIFO queue of choices that arrived before their waiter. */
  private readonly inbox = new Map<number, CoopInteractionChoice[]>();
  /**
   * seq -> the in-flight {@linkcode awaitInteractionChoice} waiter (one at a time). #861: the waiter carries
   * its `expectedKinds` so {@linkcode handle} can re-buffer (never deliver) an incoming choice whose kind is
   * outside the set - the kind-validation twin of the buffer scan.
   */
  private readonly pending = new Map<number, CoopChoiceWaiter>();
  /** #806 stall watchdog: when each parked network wait began (same keys as `pending`). */
  private readonly pendingSince = new Map<number, number>();
  /** seq -> FIFO queue of OUTCOMES that arrived before their waiter (#633, TRACK-2 Phase C). */
  private readonly outcomeInbox = new Map<number, CoopInteractionOutcome[]>();
  /** seq -> resolver for the in-flight {@linkcode awaitInteractionOutcome} (one at a time). */
  private readonly outcomePending = new Map<number, (res: CoopInteractionOutcome | null) => void>();

  /** "seq:reroll" -> the owner's rolled reward-option list that arrived before its waiter (#633 Fix #2). */
  private readonly rewardOptionsInbox = new Map<string, CoopSerializedRewardOption[]>();
  /** "seq:reroll" -> resolver for the in-flight {@linkcode awaitRewardOptions}. */
  private readonly rewardOptionsPending = new Map<string, (res: CoopSerializedRewardOption[] | null) => void>();
  /** Owner-side replay cache for exact option payloads. Bounded; cleared at session boundaries. */
  private readonly sentRewardOptions = new Map<string, CoopSerializedRewardOption[]>();

  /**
   * #698 resync-rescue: seqs that have been STICKY-cancelled by {@linkcode cancelWaiters}. Any await
   * (choice / outcome / rewardOptions) for one of these resolves `null` IMMEDIATELY - so a watcher that
   * re-parks on the SAME seq right after a cancel (the reward watch loop re-awaits after a null
   * rewardOptions) cannot re-block the phase queue ahead of a resync snapshot. Interaction seqs are
   * monotonic, so a cancelled seq never legitimately recurs (a later interaction has a higher seq).
   */
  private readonly cancelledSeqs = new Set<number>();

  constructor(transport: CoopTransport, opts: CoopInteractionRelayOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.isVersus = opts.isVersus ?? (() => false);
    this.resolveFieldSlotOwner = opts.resolveFieldSlotOwner ?? coopOwnerOfFieldIndex;
    this.isAuthorityWaitCreationFrozen = opts.isAuthorityWaitCreationFrozen ?? (() => false);
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offState = transport.onStateChange(state => {
      if (state !== "connected") {
        return;
      }
      for (const key of this.rewardOptionsPending.keys()) {
        const request = parseCoopRewardOptionsKey(key);
        if (request != null) {
          this.transport.send({ t: "requestRewardOptions", ...request });
        }
      }
    });
  }

  /** #809: ask the partner to open its Revival Blessing picker for `fieldIndex`. */
  promptRevival(fieldIndex: number, operationId?: string): void {
    coopLog("relay", `SEND revivalPrompt fieldIndex=${fieldIndex} (#809)`);
    this.transport.send({
      t: "revivalPrompt",
      fieldIndex,
      ...(operationId === undefined ? {} : { operationId }),
    });
  }

  /** Deliver a committed prompt through the same picker seam, suppressing its raw legacy echo. */
  materializeCommittedRevivalPrompt(fieldIndex: number, operationId: string): void {
    if (this.consumeEchoCredit(this.rawRevivalPromptCredits, operationId)) {
      return;
    }
    this.addEchoCredit(this.committedRevivalPromptCredits, operationId);
    this.onRevivalPrompt?.(fieldIndex);
  }

  /** #856: ask the CATCHER partner to open its full-party keep/release picker for a wild catch. */
  promptCatchFull(pokemonName: string, speciesId: number, operationId?: string): void {
    coopLog("relay", `SEND catchFullPrompt sp=${speciesId} name=${pokemonName} (#856)`);
    this.transport.send({
      t: "catchFullPrompt",
      pokemonName,
      speciesId,
      ...(operationId === undefined ? {} : { operationId }),
    });
  }

  /** Deliver a committed catch-full prompt through the picker seam, suppressing its raw legacy echo. */
  materializeCommittedCatchFullPrompt(pokemonName: string, speciesId: number, operationId: string): void {
    if (this.consumeEchoCredit(this.rawCatchFullPromptCredits, operationId)) {
      return;
    }
    this.addEchoCredit(this.committedCatchFullPromptCredits, operationId);
    this.onCatchFullPrompt?.(pokemonName, speciesId);
  }

  /** OWNER: send one pick for interaction `seq` (`kind` is routing/logging only). */
  sendInteractionChoice(
    seq: number,
    kind: string,
    choice: number,
    data?: number[],
    rewardSurface?: CoopRewardSurfaceIdentity,
  ): void {
    recordCoopUiRelayCarrier("interactionChoice", `seq=${seq} kind=${kind} choice=${choice}`);
    if (isCoopDebug()) {
      coopLog("relay", `SEND interactionChoice seq=${seq} kind=${kind} ${summarizeChoice({ choice, data })}`);
    }
    this.transport.send({
      t: "interactionChoice",
      seq,
      kind,
      choice,
      ...(data === undefined ? {} : { data }),
      ...(rewardSurface == null ? {} : { rewardSurface }),
    });
    // #record-replay: capture this OWNER-sent interaction pick (no-op unless recording on the host).
    recordReplayInteraction({
      type: "interaction",
      seq,
      kind,
      choice,
      ...(data === undefined ? {} : { data: [...data] }),
    });
    // authority-v2 SHADOW tap (contract change request 4): mirror this owner-committed interaction pick into
    // the v2 shadow harness for parity evidence. Faint-switch / revival relays are EXCLUDED (they are the
    // REPLACEMENT tap's domain - tapping them here would double-count a faint replacement). Null-guarded
    // (no-op unless a harness is active) + the tap runs under the harness's own try/catch, so a shadow fault
    // is logged, never thrown back into the relay send. Legacy owns the interaction entirely.
    if (isCoopV2ShadowActive() && kind !== "switch" && kind !== "revival") {
      tapCoopV2ShadowInteractionChoice({
        seq,
        kind,
        choice,
        ...(data === undefined ? {} : { data: [...data] }),
        ownerSeatId: this.transport.role === "host" ? 0 : 1,
      });
    }
  }

  /**
   * Deliver a host-COMMITTED interaction choice from the durable operation carrier into the same local
   * FIFO/waiter seam as a live legacy `interactionChoice` frame. This is deliberately local-only: the
   * journal already transported and authenticated the committed envelope, so re-sending it would create a
   * second network carrier. A waiting phase wakes immediately; otherwise the choice is buffered until that
   * phase opens. The surface adapter still performs its normal operation-ledger adopt before mutating.
   */
  materializeCommittedInteractionChoice(
    seq: number,
    kind: string,
    choice: number,
    data?: number[],
    operationId?: string | undefined,
    rewardSurface?: CoopRewardSurfaceIdentity,
  ): void {
    if (!COOP_DURABLE_CHOICE_ECHO_KINDS.has(kind)) {
      this.deliverInteractionChoice(seq, { choice, data, kind, operationId, rewardSurface });
      return;
    }
    const key = this.choiceCreditKey(seq, kind, choice, data, rewardSurface);
    if (this.consumeEchoCredit(this.rawChoiceCredits, key)) {
      return;
    }
    this.addEchoCredit(this.committedChoiceCredits, key);
    this.deliverInteractionChoice(seq, { choice, data, kind, operationId, rewardSurface });
  }

  /**
   * WATCHER: take the next owner choice for interaction `seq` (FIFO). Resolves
   * immediately if one is already buffered, else waits for the next to arrive, or
   * resolves `null` on timeout (the watcher then leaves the screen, never hangs).
   *
   * #861 KIND-VALIDATION: the caller declares the `expectedKinds` it legitimately consumes. A
   * buffered/incoming choice whose kind is OUTSIDE that set is RE-BUFFERED (kept in the inbox) and
   * loudly logged - it never resolves the waiter. This closes the P0 where a STALE, minutes-old
   * buffered choice at a REUSED seq (interaction counters reset per session/epoch) satisfied a new
   * epoch's reward await ahead of the host's genuine pick. Passing no `expectedKinds` opts out of
   * validation (legacy behavior - accept any), so the primitive relay tests are unaffected.
   */
  awaitInteractionChoice(
    seq: number,
    timeoutMs = this.timeoutMs,
    expectedKinds?: readonly string[],
    expectedRewardSurface?: CoopRewardSurfaceIdentity | null,
  ): Promise<CoopInteractionChoice | null> {
    if (this.cancelledSeqs.has(seq)) {
      coopWarn("relay", `AWAIT interactionChoice seq=${seq} -> STICKY-CANCELLED (resync rescue) resolve null`);
      return Promise.resolve(null);
    }
    const queue = this.inbox.get(seq);
    if (queue !== undefined && queue.length > 0) {
      // #861: scan FIFO for the first buffered entry whose kind this site accepts. Entries with a
      // NON-accepted kind (a stale/cross-family arrival at this reused seq) are LEFT in the queue
      // (re-buffered) and loudly logged - they never resolve this await. Legitimate same-family picks
      // keep strict FIFO order because we take the FIRST accepted one.
      const matchIdx = queue.findIndex(
        entry =>
          kindAccepted(entry.kind, expectedKinds) && rewardSurfaceAccepted(entry.rewardSurface, expectedRewardSurface),
      );
      if (matchIdx >= 0) {
        for (let i = 0; i < matchIdx; i++) {
          coopWarn(
            "relay",
            `AWAIT interactionChoice seq=${seq} SKIP buffered WRONG-KIND entry kind=${queue[i].kind ?? "?"} `
              + `(expected [${(expectedKinds ?? []).join(",")}]) -> re-buffered, NOT resolved (#861)`,
          );
        }
        const next = queue.splice(matchIdx, 1)[0];
        if (queue.length === 0) {
          this.inbox.delete(seq);
        }
        if (isCoopDebug()) {
          coopLog(
            "relay",
            `AWAIT interactionChoice seq=${seq} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve ${summarizeChoice(next)}`,
          );
        }
        return Promise.resolve(next);
      }
      // No accepted entry buffered: the ones present are all wrong-kind. Leave them re-buffered and
      // fall through to a network wait for the genuine pick.
      coopWarn(
        "relay",
        `AWAIT interactionChoice seq=${seq} all ${queue.length} buffered entries WRONG-KIND `
          + `(expected [${(expectedKinds ?? []).join(",")}]) -> re-buffered, network-wait (#861)`,
      );
    }
    coopLog(
      "relay",
      `AWAIT interactionChoice seq=${seq} timeoutMs=${timeoutMs} expected=[${(expectedKinds ?? []).join(",")}] -> network-wait`,
    );
    if (this.isAuthorityWaitCreationFrozen()) {
      coopWarn("relay", `AWAIT interactionChoice seq=${seq} REFUSED (Authority V2 recovery fence held)`);
      return Promise.resolve(null);
    }
    this.pendingSince.set(seq, Date.now());
    // Supersede any stale waiter parked on this seq.
    const prior = this.pending.get(seq);
    if (prior !== undefined) {
      coopWarn("relay", `AWAIT interactionChoice seq=${seq} SUPERSEDE stale waiter -> resolved null`);
      prior.finish(null);
    }
    return new Promise<CoopInteractionChoice | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopInteractionChoice | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(seq)?.finish === finish) {
          this.pendingSince.delete(seq);
          this.pending.delete(seq);
        }
        if (res === null) {
          coopWarn("relay", `AWAIT interactionChoice seq=${seq} RESOLVE null (TIMEOUT or supersede) -> watcher leaves`);
        } else {
          coopLog("relay", `AWAIT interactionChoice seq=${seq} RESOLVE ${summarizeChoice(res)}`);
        }
        resolve(res);
      };
      this.pending.set(seq, { finish, expectedKinds, expectedRewardSurface });
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /**
   * OWNER (#633, TRACK-2 Phase C): stream the HOST-resolved authoritative OUTCOME of one
   * pick for interaction `seq` (`kind` is routing/logging only). The watcher adopts it
   * verbatim instead of re-deriving from its own pool, so a pool divergence can never
   * change the result. Same FIFO-per-seq semantics as the choice relay.
   */
  sendInteractionOutcome(seq: number, kind: string, outcome: CoopInteractionOutcome): void {
    if (outcome.k === "mePresent") {
      // Snapshot the exact screen before the carrier can be dropped. The pin-state seam self-gates to a
      // live ME, so unrelated outcomes and non-co-op/legacy sessions remain byte-identical.
      setCoopMeActivePresentation(outcome);
    }
    recordCoopUiRelayCarrier("interactionOutcome", `seq=${seq} kind=${kind} outcome=${outcome.k}`);
    if (isCoopDebug()) {
      coopLog("relay", `SEND interactionOutcome seq=${seq} kind=${kind} ${summarizeOutcome(outcome)}`);
    }
    this.transport.send({ t: "interactionOutcome", seq, kind, outcome });
  }

  /**
   * Deliver a host-COMMITTED outcome from the durable carrier into the real outcome FIFO. The matching
   * legacy frame may arrive before or after the envelope; one credit on either side suppresses that echo,
   * so the phase observes exactly one presentation without caring which carrier won the race.
   */
  materializeCommittedInteractionOutcome(seq: number, outcome: CoopInteractionOutcome): void {
    const key = `${seq}:${JSON.stringify(outcome)}`;
    if (this.consumeEchoCredit(this.rawOutcomeCredits, key)) {
      return;
    }
    this.addEchoCredit(this.committedOutcomeCredits, key);
    this.deliverInteractionOutcome(seq, outcome, "JOURNAL");
  }

  /**
   * Read-only ordering probe used by replay surfaces before they arm competing presentation edges.
   * This deliberately does not dequeue the outcome: {@linkcode awaitInteractionOutcome} remains the
   * only consumer, preserving FIFO and the relay's single-waiter semantics.
   */
  hasBufferedInteractionOutcomeFor(seq: number): boolean {
    return (this.outcomeInbox.get(seq)?.length ?? 0) > 0;
  }

  /**
   * WATCHER (#633, TRACK-2 Phase C): take the next host-resolved outcome for interaction
   * `seq` (FIFO). Resolves immediately if one is buffered, else waits for the next, or
   * resolves `null` on timeout (the watcher then leaves, never hangs). Mirrors
   * {@linkcode awaitInteractionChoice} exactly.
   */
  awaitInteractionOutcome(seq: number, timeoutMs = this.timeoutMs): Promise<CoopInteractionOutcome | null> {
    if (this.cancelledSeqs.has(seq)) {
      coopWarn("relay", `AWAIT interactionOutcome seq=${seq} -> STICKY-CANCELLED (resync rescue) resolve null`);
      return Promise.resolve(null);
    }
    const queue = this.outcomeInbox.get(seq);
    if (queue !== undefined && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) {
        this.outcomeInbox.delete(seq);
      }
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `AWAIT interactionOutcome seq=${seq} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve ${summarizeOutcome(next)}`,
        );
      }
      return Promise.resolve(next);
    }
    coopLog("relay", `AWAIT interactionOutcome seq=${seq} timeoutMs=${timeoutMs} -> network-wait`);
    if (this.isAuthorityWaitCreationFrozen()) {
      coopWarn("relay", `AWAIT interactionOutcome seq=${seq} REFUSED (Authority V2 recovery fence held)`);
      return Promise.resolve(null);
    }
    // Supersede any stale waiter parked on this seq.
    if (this.outcomePending.has(seq)) {
      coopWarn("relay", `AWAIT interactionOutcome seq=${seq} SUPERSEDE stale waiter -> resolved null`);
    }
    this.outcomePending.get(seq)?.(null);
    return new Promise<CoopInteractionOutcome | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopInteractionOutcome | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.outcomePending.get(seq) === finish) {
          this.outcomePending.delete(seq);
        }
        if (res === null) {
          coopWarn(
            "relay",
            `AWAIT interactionOutcome seq=${seq} RESOLVE null (TIMEOUT or supersede) -> watcher leaves`,
          );
        } else {
          coopLog("relay", `AWAIT interactionOutcome seq=${seq} RESOLVE ${summarizeOutcome(res)}`);
        }
        resolve(res);
      };
      this.outcomePending.set(seq, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
    });
  }

  /** OWNER: stream the exact reward-option list rolled for `seq` / `reroll` (#633 Fix #2). */
  sendRewardOptions(
    seq: number,
    reroll: number,
    options: CoopSerializedRewardOption[],
    rewardSurface?: CoopRewardSurfaceIdentity,
  ): void {
    const key = rewardOptionsKey(seq, reroll, rewardSurface);
    this.sentRewardOptions.set(key, options);
    if (this.sentRewardOptions.size > 64) {
      const oldest = this.sentRewardOptions.keys().next().value;
      if (oldest !== undefined) {
        this.sentRewardOptions.delete(oldest);
      }
    }
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `SEND rewardOptions seq=${seq} reroll=${reroll} count=${options.length} ids=[${options.map(o => o.id).join(",")}]`,
      );
    }
    this.transport.send({
      t: "rewardOptions",
      seq,
      reroll,
      options,
      ...(rewardSurface == null ? {} : { rewardSurface }),
    });
  }

  /**
   * WATCHER: take the owner's rolled reward-option list for `seq` / `reroll`. Resolves
   * immediately if it already arrived (buffered), else waits for it, or resolves `null`
   * on timeout. Callers must treat null as an authoritative recovery boundary and never
   * continue with locally-rolled options.
   */
  awaitRewardOptions(
    seq: number,
    reroll: number,
    timeoutMs = this.timeoutMs,
    rewardSurface?: CoopRewardSurfaceIdentity,
  ): Promise<CoopSerializedRewardOption[] | null> {
    if (this.cancelledSeqs.has(seq)) {
      coopWarn(
        "relay",
        `AWAIT rewardOptions seq=${seq} reroll=${reroll} -> STICKY-CANCELLED (resync rescue) resolve null`,
      );
      return Promise.resolve(null);
    }
    const key = rewardOptionsKey(seq, reroll, rewardSurface);
    const buffered = this.rewardOptionsInbox.get(key);
    if (buffered !== undefined) {
      this.rewardOptionsInbox.delete(key);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `AWAIT rewardOptions key=${key} timeoutMs=${timeoutMs} -> BUFFER-HIT resolve count=${buffered.length}`,
        );
      }
      return Promise.resolve(buffered);
    }
    coopLog("relay", `AWAIT rewardOptions key=${key} timeoutMs=${timeoutMs} -> network-wait`);
    if (this.isAuthorityWaitCreationFrozen()) {
      coopWarn("relay", `AWAIT rewardOptions key=${key} REFUSED (Authority V2 recovery fence held)`);
      return Promise.resolve(null);
    }
    // Supersede any stale waiter on this key.
    if (this.rewardOptionsPending.has(key)) {
      coopWarn("relay", `AWAIT rewardOptions key=${key} SUPERSEDE stale waiter -> resolved null`);
    }
    this.rewardOptionsPending.get(key)?.(null);
    return new Promise<CoopSerializedRewardOption[] | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopSerializedRewardOption[] | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.rewardOptionsPending.get(key) === finish) {
          this.rewardOptionsPending.delete(key);
        }
        if (res === null) {
          coopWarn(
            "relay",
            `AWAIT rewardOptions key=${key} RESOLVE null (TIMEOUT or supersede) -> caller must FAIL CLOSED`,
          );
        } else {
          coopLog("relay", `AWAIT rewardOptions key=${key} RESOLVE count=${res.length}`);
        }
        resolve(res);
      };
      this.rewardOptionsPending.set(key, finish);
      cancelTimer = this.schedule(() => finish(null), timeoutMs);
      coopLog("relay", `SEND requestRewardOptions key=${key} (authoritative replay)`);
      this.transport.send({
        t: "requestRewardOptions",
        seq,
        reroll,
        ...(rewardSurface == null ? {} : { rewardSurface }),
      });
    });
  }

  /**
   * #698 resync-rescue (WATCHER-only safety net): STICKY-cancel every in-flight watcher wait so a guest
   * parked on an interaction the owner already left (e.g. an orphaned reward shop after a TM/Memory
   * continuation) can never block the phase queue ahead of a resync snapshot apply. Each parked
   * choice/outcome/rewardOptions waiter resolves to `null` (reward-option await sites fail closed; other
   * legacy interaction waits take their bounded recovery path), and the waiter's seq is recorded so a phase that immediately
   * RE-parks on the same seq also resolves null at once. A no-op when nothing is parked. Unlike
   * {@linkcode dispose}, the relay stays alive (the transport listener is untouched) - the session
   * continues after the resync heals the state.
   */
  /**
   * #698 resync-rescue, scoped (#633 reward-shop-desync fix): cancel ONLY the parked waiters that
   * `shouldCancel(seq)` selects. The resync site passes a predicate that returns true only for a
   * genuinely-ORPHANED interaction (the owner already advanced past it) - so a benign mid-shop
   * battle resync no longer sticky-cancels a LIVE reward-shop wait and drops the watcher off the
   * shop while the owner is still picking. Default (no predicate) cancels everything (the legacy
   * dispose-like behavior the unit tests assert). Each cancelled seq is recorded so a phase that
   * immediately re-parks on it also resolves null at once; a SPARED live seq is NOT sticky-marked,
   * so the owner's pick still resolves it normally.
   */
  /**
   * #806 stall watchdog: age (ms) of the OLDEST parked network wait, or -1 when none.
   * A client with a positive value cannot produce the next message for that seq itself -
   * two clients both reporting 20s+ is a proven mutual-wait deadlock.
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

  /**
   * #diagnostics: a compact, read-only snapshot of the interaction relay's CURRENTLY-AWAITED picks
   * (the seq being blocked on, the kinds that seq legitimately accepts, and how long it has been
   * parked). Assembled ON DEMAND for a bug report's control-plane block - a parked/growing wait here
   * is the pending interaction the whole session is blocked on (the top co-op softlock signature).
   * Pure read; never mutates relay state.
   */
  describeAwaitedInteractions(): {
    seq: number;
    ageMs: number;
    expectedKinds: readonly string[];
  }[] {
    const now = Date.now();
    const out: {
      seq: number;
      ageMs: number;
      expectedKinds: readonly string[];
    }[] = [];
    for (const [seq, since] of this.pendingSince) {
      out.push({
        seq,
        ageMs: now - since,
        expectedKinds: this.pending.get(seq)?.expectedKinds ?? [],
      });
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  /**
   * #821: fired when rewardOptions are BUFFERED with no waiter (the ME embedded-shop case:
   * the owner's engine opened its shop while the watcher is parked in the ME await).
   * Phase-scoped - CoopReplayMePhase assigns it on entry and clears it on settle.
   */
  public onRewardOptionsBuffered: ((key: string) => void) | null = null;

  /** Exact first buffered reward-options address matching a key prefix (already-arrived/reconnect race). */
  bufferedRewardOptionsKeyFor(prefix: string): string | null {
    for (const k of this.rewardOptionsInbox.keys()) {
      if (String(k).startsWith(prefix)) {
        return k;
      }
    }
    return null;
  }

  /** #821 compatibility predicate for callers that need only buffered presence. */
  hasBufferedRewardOptionsFor(prefix: string): boolean {
    return this.bufferedRewardOptionsKeyFor(prefix) != null;
  }

  cancelWaiters(shouldCancel: (seq: number) => boolean = () => true): void {
    const seqs = new Set<number>();
    // Snapshot the SELECTED resolvers per map (finish() self-deletes from its map, so iterating a
    // snapshot is safe). Each map has its own resolver type, so keep them separate (no variance hack).
    const choiceFinishers: Array<(res: CoopInteractionChoice | null) => void> = [];
    const outcomeFinishers: Array<(res: CoopInteractionOutcome | null) => void> = [];
    const rewardFinishers: Array<(res: CoopSerializedRewardOption[] | null) => void> = [];
    for (const [seq, waiter] of this.pending) {
      if (shouldCancel(seq)) {
        seqs.add(seq);
        choiceFinishers.push(waiter.finish);
      }
    }
    for (const [seq, finish] of this.outcomePending) {
      if (shouldCancel(seq)) {
        seqs.add(seq);
        outcomeFinishers.push(finish);
      }
    }
    for (const [key, finish] of this.rewardOptionsPending) {
      const seq = Number(key.split(":")[0]);
      if (!Number.isNaN(seq) && shouldCancel(seq)) {
        seqs.add(seq);
        rewardFinishers.push(finish);
      }
    }
    if (seqs.size === 0) {
      coopLog("relay", "cancelWaiters() no orphaned waiters selected -> nothing cancelled (live waits spared)");
      return;
    }
    coopWarn(
      "relay",
      `cancelWaiters() sticky-cancel seqs=[${[...seqs].join(",")}] (resync rescue) -> selected resolve null`,
    );
    for (const seq of seqs) {
      this.cancelledSeqs.add(seq);
    }
    for (const finish of choiceFinishers) {
      finish(null);
    }
    for (const finish of outcomeFinishers) {
      finish(null);
    }
    for (const finish of rewardFinishers) {
      finish(null);
    }
  }

  /** Stop listening and fail any in-flight waits. */
  dispose(): void {
    const inFlight = this.pending.size + this.outcomePending.size + this.rewardOptionsPending.size;
    if (inFlight > 0) {
      coopWarn(
        "relay",
        `dispose() failing inFlightWaiters=${inFlight} (choice=${this.pending.size} outcome=${this.outcomePending.size} rewardOptions=${this.rewardOptionsPending.size}) -> all resolve null`,
      );
    } else {
      coopLog("relay", "dispose() (no in-flight waiters)");
    }
    this.offMessage();
    this.offState();
    for (const waiter of [...this.pending.values()]) {
      waiter.finish(null);
    }
    for (const finish of [...this.outcomePending.values()]) {
      finish(null);
    }
    for (const finish of [...this.rewardOptionsPending.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.pendingSince.clear();
    this.inbox.clear();
    this.outcomePending.clear();
    this.outcomeInbox.clear();
    this.rawOutcomeCredits.clear();
    this.committedOutcomeCredits.clear();
    this.rawChoiceCredits.clear();
    this.committedChoiceCredits.clear();
    this.rawRevivalPromptCredits.clear();
    this.committedRevivalPromptCredits.clear();
    this.rawCatchFullPromptCredits.clear();
    this.committedCatchFullPromptCredits.clear();
    this.rewardOptionsPending.clear();
    this.rewardOptionsInbox.clear();
    this.sentRewardOptions.clear();
    this.cancelledSeqs.clear();
  }

  /**
   * #861 SESSION-BOUNDARY PURGE: drop every BUFFERED arrival (choice / outcome / rewardOptions) and the
   * sticky-cancel marks, WITHOUT tearing down the transport listener or failing any LIVE waiter. Called at
   * every session boundary where the SAME relay instance is carried across a session/epoch change (a resume
   * boot / launch adopt onto a live runtime, a hot-rejoin full-resync): interaction seqs reset per epoch
   * (the reward channel is base 0 + a counter), so a prior epoch's buffered message sits at a seq the NEW
   * epoch will reuse, and a plain FIFO buffer-hit would satisfy the new await with the stale pick (the P0).
   * Purging the buffers guarantees only THIS epoch's genuine, freshly-arriving picks can ever resolve an
   * await. Unlike {@linkcode dispose} the relay stays alive - the session continues after the boundary.
   */
  purgeBufferedArrivals(reason: string): void {
    const buffered = this.inbox.size + this.outcomeInbox.size + this.rewardOptionsInbox.size + this.cancelledSeqs.size;
    if (buffered > 0) {
      coopWarn(
        "relay",
        `purgeBufferedArrivals(${reason}) dropping inbox=${this.inbox.size} outcomeInbox=${this.outcomeInbox.size} `
          + `rewardOptionsInbox=${this.rewardOptionsInbox.size} cancelledSeqs=${this.cancelledSeqs.size} `
          + "(#861 stale-session isolation)",
      );
    } else {
      coopLog("relay", `purgeBufferedArrivals(${reason}) nothing buffered (#861)`);
    }
    this.inbox.clear();
    this.outcomeInbox.clear();
    this.rawOutcomeCredits.clear();
    this.committedOutcomeCredits.clear();
    this.rawChoiceCredits.clear();
    this.committedChoiceCredits.clear();
    this.rawRevivalPromptCredits.clear();
    this.committedRevivalPromptCredits.clear();
    this.rawCatchFullPromptCredits.clear();
    this.committedCatchFullPromptCredits.clear();
    this.rewardOptionsInbox.clear();
    this.sentRewardOptions.clear();
    // A seq sticky-cancelled in the PRIOR epoch must not keep resolving null in the NEW epoch (seqs reuse
    // low counters), so clear the cancel marks alongside the buffers.
    this.cancelledSeqs.clear();
  }

  /**
   * #809: fired when the partner asks THIS client to pick a Revival Blessing target for its
   * own mon. Wired by the runtime (queues CoopGuestRevivalPhase); null in engine-free tests.
   */
  onRevivalPrompt: ((fieldIndex: number) => void) | null = null;

  /** Host-forwarded per-move picker presentation; runtime wires the authoritative guest opener. */
  onLearnMoveForward: ((outcome: Extract<CoopInteractionOutcome, { k: "learnMoveForward" }>) => void) | null = null;

  /** Host-forwarded batch picker presentation; runtime wires the authoritative guest opener. */
  onLearnMoveBatchForward: ((outcome: Extract<CoopInteractionOutcome, { k: "learnMoveBatchForward" }>) => void) | null =
    null;

  /**
   * #856: fired when the partner (the sole-engine host) asks THIS client - the CATCHER - to drive the
   * full-party keep/release picker for a wild catch it threw. Wired by the runtime (queues
   * CoopGuestCatchFullPhase on the guest); null in engine-free tests.
   */
  onCatchFullPrompt: ((pokemonName: string, speciesId: number) => void) | null = null;

  /**
   * #829 malicious-peer hardening: whether a received `interactionChoice` at `seq` is a FORGED
   * cross-owner faint-replacement switch. A faint-replacement pick (COOP_FAINT_SWITCH_SEQ_BASE +
   * fieldIndex) is a CROSS-OWNER relay - the sending peer relays the replacement for ITS OWN field
   * slot and the receiver (the authoritative host) applies that cursor to the slot. Every received
   * message comes from our PEER (the remote role), so in the fixed 2-player seat map a pick whose slot
   * resolves to THIS client's OWN seat is a forged switch for a mon the peer does not command. Such a
   * message is dropped LOUDLY ([coop:security]) and never applied. Scoped to the faint-switch band
   * ONLY - the sole interactionChoice channel where slot ownership is well defined; every other seq
   * (reward / shop / ME / revival) returns false, so the legitimate owner paths (guarded by
   * coop-duo-faint-switch + the duo suites) are byte-for-byte unaffected. Cheap + conservative + pure.
   */
  private isForgedCrossOwnerSwitch(seq: number, choice: number): boolean {
    const faintSwitchSlot = seq - COOP_FAINT_SWITCH_SEQ_BASE;
    if (faintSwitchSlot < 0 || faintSwitchSlot >= COOP_FAINT_SWITCH_SLOT_COUNT) {
      return false;
    }
    // Showdown 1v1: the fixed 2-player seat map does not hold - the guest owns the WHOLE enemy side and
    // relays faint-replacement picks for the host's enemy field slots (seat-map owner "host"). Disable
    // the seat-map forgery check here; the awaiting host phase validates the pick's legality instead.
    if (this.isVersus()) {
      return false;
    }
    const slotOwner = this.resolveFieldSlotOwner(faintSwitchSlot);
    if (slotOwner !== this.transport.role) {
      return false; // the addressed slot is the PEER's own seat -> a legitimate cross-owner pick.
    }
    // The addressed slot belongs to OUR seat, but the message is from the PEER -> a forged cross-owner
    // switch. Un-gated console.warn (NOT coopWarn, which is silenced when co-op debug is off) so this
    // surfaces even in a production build; never crash, never apply.
    console.warn(
      "[coop:security] dropped forged cross-owner switch: peer relayed a faint-replacement pick for "
        + `field slot ${faintSwitchSlot} (owned by ${slotOwner}, this client's OWN seat) seq=${seq} `
        + `choice=${choice} - a switch pick must come from the slot's owner`,
    );
    return true;
  }

  /** Route a trusted local/wire choice to an accepting waiter or the per-seq FIFO. */
  private deliverInteractionChoice(seq: number, choice: CoopInteractionChoice): void {
    const waiter = this.pending.get(seq);
    if (
      waiter
      && kindAccepted(choice.kind, waiter.expectedKinds)
      && rewardSurfaceAccepted(choice.rewardSurface, waiter.expectedRewardSurface)
    ) {
      if (isCoopDebug()) {
        coopLog("relay", `DELIVER interactionChoice seq=${seq} -> waiter ${summarizeChoice(choice)}`);
      }
      waiter.finish(choice);
      return;
    }
    if (waiter) {
      coopWarn(
        "relay",
        `DELIVER interactionChoice seq=${seq} kind=${choice.kind ?? "?"} surface=${rewardSurfaceKey(choice.rewardSurface)} MISMATCH parked waiter `
          + `(expected kinds=[${(waiter.expectedKinds ?? []).join(",")}] surface=${waiter.expectedRewardSurface === undefined ? "any" : rewardSurfaceKey(waiter.expectedRewardSurface ?? undefined)}) -> BUFFER, waiter stays parked (#861/P36)`,
      );
    }
    const queue = this.inbox.get(seq) ?? [];
    queue.push(choice);
    this.inbox.set(seq, queue);
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `DELIVER interactionChoice seq=${seq} -> BUFFER inbox depth=${queue.length} ${summarizeChoice(choice)}`,
      );
    }
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "revivalPrompt") {
      coopLog("relay", `RECV revivalPrompt fieldIndex=${msg.fieldIndex} (#809)`);
      if (msg.operationId !== undefined) {
        if (this.consumeEchoCredit(this.committedRevivalPromptCredits, msg.operationId)) {
          return;
        }
        this.addEchoCredit(this.rawRevivalPromptCredits, msg.operationId);
      }
      this.onRevivalPrompt?.(msg.fieldIndex);
      return;
    }
    if (msg.t === "catchFullPrompt") {
      coopLog("relay", `RECV catchFullPrompt sp=${msg.speciesId} name=${msg.pokemonName} (#856)`);
      if (msg.operationId !== undefined) {
        if (this.consumeEchoCredit(this.committedCatchFullPromptCredits, msg.operationId)) {
          return;
        }
        this.addEchoCredit(this.rawCatchFullPromptCredits, msg.operationId);
      }
      this.onCatchFullPrompt?.(msg.pokemonName, msg.speciesId);
      return;
    }
    if (msg.t === "interactionOutcome") {
      const key = `${msg.seq}:${JSON.stringify(msg.outcome)}`;
      if (this.consumeEchoCredit(this.committedOutcomeCredits, key)) {
        return;
      }
      this.addEchoCredit(this.rawOutcomeCredits, key);
      this.deliverInteractionOutcome(msg.seq, msg.outcome, "RECV");
      return;
    }
    if (msg.t === "rewardOptions") {
      if (msg.rewardSurface != null && !isWireRewardSurfaceIdentity(msg.rewardSurface)) {
        coopWarn("relay", "RECV rewardOptions -> invalid ordered reward surface");
        return;
      }
      const key = rewardOptionsKey(msg.seq, msg.reroll, msg.rewardSurface);
      const waiter = this.rewardOptionsPending.get(key);
      if (waiter) {
        if (isCoopDebug()) {
          coopLog("relay", `RECV rewardOptions key=${key} -> deliver-to-waiter count=${msg.options.length}`);
        }
        waiter(msg.options);
        return;
      }
      // No waiter yet - buffer (latest wins per key) for the next awaitRewardOptions.
      this.rewardOptionsInbox.set(key, msg.options);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `RECV rewardOptions key=${key} -> BUFFER rewardOptionsInbox (latest-wins) count=${msg.options.length}`,
        );
      }
      // #821/#830 (audit P0#3): notify the live listener (the guest's CoopReplayMePhase) that an
      // embedded ME reward shop opened on the owner's engine with NO local consumer - the shop
      // handoff. This fires UNCONDITIONALLY on the buffer branch: the old placement (inside the
      // waiter branch, behind isCoopDebug) contradicted its own doc and only ever worked because
      // COOP_DEBUG_DEFAULT is true - a latent strand for any production build that flips it.
      try {
        this.onRewardOptionsBuffered?.(key);
      } catch {
        /* the notification must never break the buffer path */
      }
      return;
    }
    if (msg.t === "requestRewardOptions") {
      if (msg.rewardSurface != null && !isWireRewardSurfaceIdentity(msg.rewardSurface)) {
        coopWarn("relay", "RECV requestRewardOptions -> invalid ordered reward surface");
        return;
      }
      const key = rewardOptionsKey(msg.seq, msg.reroll, msg.rewardSurface);
      const options = this.sentRewardOptions.get(key);
      if (options == null) {
        coopWarn("relay", `RECV requestRewardOptions key=${key} -> no authoritative cache`);
        return;
      }
      coopLog("relay", `RECV requestRewardOptions key=${key} -> REPLAY count=${options.length}`);
      this.transport.send({
        t: "rewardOptions",
        seq: msg.seq,
        reroll: msg.reroll,
        options,
        ...(msg.rewardSurface == null ? {} : { rewardSurface: msg.rewardSurface }),
      });
      return;
    }
    if (msg.t !== "interactionChoice") {
      return;
    }
    if (msg.rewardSurface != null && !isWireRewardSurfaceIdentity(msg.rewardSurface)) {
      coopWarn("relay", "RECV interactionChoice -> invalid ordered reward surface");
      return;
    }
    // #829 malicious-peer hardening: drop a forged cross-owner faint-replacement switch pick before it
    // is ever recorded / buffered / delivered / applied.
    if (this.isForgedCrossOwnerSwitch(msg.seq, msg.choice)) {
      return;
    }
    // #record-replay: capture this RECEIVED (partner-owned) interaction pick so the host's single trace
    // captures EVERY committed interaction, not just its own (no-op unless recording on the host).
    recordReplayInteraction({
      type: "interaction",
      seq: msg.seq,
      kind: msg.kind,
      choice: msg.choice,
      ...(msg.data === undefined ? {} : { data: [...msg.data] }),
    });
    if (COOP_DURABLE_CHOICE_ECHO_KINDS.has(msg.kind)) {
      const key = this.choiceCreditKey(msg.seq, msg.kind, msg.choice, msg.data, msg.rewardSurface);
      if (this.consumeEchoCredit(this.committedChoiceCredits, key)) {
        return;
      }
      this.addTransientRawChoiceCredit(key);
    }
    // #861: carry the wire `kind` onto the choice so the KIND-VALIDATION can gate delivery + buffer-hits.
    this.deliverInteractionChoice(msg.seq, {
      choice: msg.choice,
      data: msg.data,
      kind: msg.kind,
      rewardSurface: msg.rewardSurface,
    });
  }

  private choiceCreditKey(
    seq: number,
    kind: string,
    choice: number,
    data: number[] | undefined,
    rewardSurface?: CoopRewardSurfaceIdentity,
  ): string {
    return `${seq}:${kind}:${choice}:${rewardSurfaceKey(rewardSurface)}:${JSON.stringify(data ?? null)}`;
  }

  private addEchoCredit(credits: Map<string, number>, key: string): void {
    credits.set(key, (credits.get(key) ?? 0) + 1);
  }

  private addTransientRawChoiceCredit(key: string): void {
    this.addEchoCredit(this.rawChoiceCredits, key);
    queueMicrotask(() => {
      this.consumeEchoCredit(this.rawChoiceCredits, key);
    });
  }

  private consumeEchoCredit(credits: Map<string, number>, key: string): boolean {
    const count = credits.get(key) ?? 0;
    if (count <= 0) {
      return false;
    }
    if (count === 1) {
      credits.delete(key);
    } else {
      credits.set(key, count - 1);
    }
    return true;
  }

  private deliverInteractionOutcome(seq: number, outcome: CoopInteractionOutcome, source: "RECV" | "JOURNAL"): void {
    // Forward-only presentations are consumed by persistent runtime openers rather than a phase-local
    // outcome waiter. Routing them here lets raw and durable carriers share the relay's echo suppression.
    if (outcome.k === "learnMoveForward" && this.onLearnMoveForward != null) {
      this.onLearnMoveForward(outcome);
      return;
    }
    if (outcome.k === "learnMoveBatchForward" && this.onLearnMoveBatchForward != null) {
      this.onLearnMoveBatchForward(outcome);
      return;
    }
    const waiter = this.outcomePending.get(seq);
    if (waiter) {
      if (isCoopDebug()) {
        coopLog("relay", `${source} interactionOutcome seq=${seq} -> deliver-to-waiter ${summarizeOutcome(outcome)}`);
      }
      waiter(outcome);
      return;
    }
    const queue = this.outcomeInbox.get(seq) ?? [];
    queue.push(outcome);
    this.outcomeInbox.set(seq, queue);
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `${source} interactionOutcome seq=${seq} -> BUFFER outcomeInbox depth=${queue.length} ${summarizeOutcome(outcome)}`,
      );
    }
  }
}

// =============================================================================
// #863: one-sided ORPHAN backstop for the high-band watcher screens (biome pick / crossroads).
//
// The live wave-10 report ("partner chose map but I am stuck in the map screen"): the WATCHER pins the
// biome-pick interaction, opens the mirrored ER_MAP, and awaits the owner's relayed pick on
// `COOP_BIOME_PICK_SEQ_BASE + counter`. The owner picks + advances, but its relay never resolves the
// watcher's waiter (a lost/raced pick at the wave boundary). The generic orphan-rescue -
// `relay.cancelWaiters(seq => controller.peerAdvancedPastInteraction(seq))` - can NOT see these bands: it
// compares the RELAY seq (BASE + counter) against the peer's broadcast COUNTER, so `peerAdvancedPast` is
// always false for an offset band. And between waves there is no turn checksum / resync event to fire that
// rescue at all, while the stall watchdog only recovers a MUTUAL stall (the owner here is NOT stalled - it
// moved on). So the watcher freezes for the full COOP_BIOME_WAIT_MS (20 min), input-blocked by the still-
// open cursor mirror. This helper closes that gap for the offset bands by checking the peer's advance
// against the raw COUNTER (which the caller knows) instead of the relay seq.
// =============================================================================

/** The structural slice of the session controller this backstop needs (avoids a circular import). */
export interface CoopPeerAdvanceProbe {
  /** Cancellable await that resolves once the PEER broadcasts a counter strictly beyond `counter`
   *  (owner committed + moved on). `cancel()` drops the waiter if the relayed pick wins the race first. */
  awaitPeerAdvancePast(counter: number): {
    promise: Promise<void>;
    cancel: () => void;
  };
}

/** When the owner is observed to have advanced past the interaction, how long to still let a genuinely
 *  IN-FLIGHT owner pick land + WIN (correct biome) before dismissing to the deterministic fallback. Small,
 *  since a lost pick never arrives; overridable for tests (default 750ms). */
let coopOrphanGraceMs = 750;
export function setCoopOrphanGraceMs(ms: number): void {
  coopOrphanGraceMs = ms;
}
export function resetCoopOrphanGraceMs(): void {
  coopOrphanGraceMs = 750;
}
export function getCoopOrphanGraceMs(): number {
  return coopOrphanGraceMs;
}

/**
 * WATCHER helper (#863): await the owner's relayed choice on `seq` (full COOP_BIOME_WAIT_MS, so the relay's
 * own null is still the disconnected-owner terminal), BUT race it against a one-sided ORPHAN backstop - the
 * OWNER advancing PAST the interaction pinned at `pinnedCounter` (it committed + moved on) while its pick
 * relay never reached us (the live wave-10 "partner chose map, I'm stuck in the map screen"). A genuinely
 * relayed pick always wins the race; even if the owner's advance broadcast beats the pick over the wire, a
 * brief GRACE lets the in-flight pick land + win, so the correct biome is never raced into a needless
 * fallback. Only a TRULY-lost pick falls through to null promptly, so the caller applies its deterministic
 * fallback (self-heals via the host-authoritative wave-start sync) instead of freezing for 20 minutes.
 *
 * The relay `seq` for these high-band screens (biome pick / crossroads) is `BASE + counter`, NOT the raw
 * counter, so the peer-advance MUST be probed by `pinnedCounter` - the generic seq-based orphan-rescue
 * (`cancelWaiters(peerAdvancedPastInteraction)`) can't see these offset bands. With no controller this
 * degrades to a plain single long await. Never throws.
 */
export async function awaitCoopChoiceWithOrphanBackstop(
  relay: CoopInteractionRelay,
  controller: CoopPeerAdvanceProbe | null,
  seq: number,
  pinnedCounter: number,
  expectedKinds: readonly string[],
): Promise<CoopInteractionChoice | null> {
  const pick = relay.awaitInteractionChoice(seq, COOP_BIOME_WAIT_MS, expectedKinds);
  if (controller == null) {
    return pick;
  }
  const orphan = controller.awaitPeerAdvancePast(pinnedCounter);
  const outcome = await Promise.race([
    pick.then(res => ({ res }) as const),
    orphan.promise.then(() => ({ orphaned: true }) as const),
  ]);
  if ("res" in outcome) {
    orphan.cancel(); // the relayed pick (or the relay's own disconnected-owner null) won - drop the waiter
    return outcome.res;
  }
  // Orphaned: the owner advanced PAST this interaction. Let a genuinely in-flight pick WIN within a brief
  // grace; else dismiss to the deterministic fallback (null). Cancel the parked long `pick` waiter so it
  // strands neither a 20-min timer nor a late resolve into a dead phase.
  const graced = await Promise.race([pick, new Promise<null>(r => setTimeout(() => r(null), getCoopOrphanGraceMs()))]);
  if (graced != null) {
    return graced;
  }
  relay.cancelWaiters(s => s === seq);
  coopWarn(
    "relay",
    `WATCHER orphan backstop: owner advanced PAST interaction ${pinnedCounter} with NO pick on seq=${seq} `
      + "-> dismissing to the deterministic fallback (no 20-min map/crossroads freeze) (#863)",
  );
  return null;
}

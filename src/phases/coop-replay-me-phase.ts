/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { applyCoopMeOutcome, consumeCoopMeOutcomeRollbackFatal } from "#data/elite-redux/coop/coop-battle-engine";
import { openGuestMeEmbeddedShop } from "#data/elite-redux/coop/coop-biome-shop";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { adoptCoopEnemiesStructural } from "#data/elite-redux/coop/coop-enemy-builder";
import { COOP_INTERACTION_LEAVE, type CoopInteractionChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import {
  adoptMeWatcherChoice,
  commitMeOwnerIntent,
  coopMeTerminalSanctionedTails,
  isCoopMeOperationEnabled,
  isCoopMeOperationJournalActive,
  settleCoopMeOwnerIntentRetries,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  type CoopMeCommittedTerminalTransaction,
  CoopMePresentationIntentGate,
  captureCoopActiveMysteryControl,
  coopMeHandoffBattleStarted,
  coopMeInteractionStartValue,
  resolveCoopMeOwnerIntentRebind,
  setCoopMeHandoffBattleStarted,
  setCoopMeInteractionStart,
  setOnMeCommittedTerminal,
  setOnMePinCleared,
  setOnMeSnapshotRebind,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_BATTLE_HANDOFF, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import type { CoopMeTerminalPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import { setCoopWaveTailSanction } from "#data/elite-redux/coop/coop-renderer-gate";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
  setCoopMeBattleInteractionCounter,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ME_PUMP_SEQ_BASE, COOP_ME_TERMINAL_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import type {
  CoopActiveMysteryEncounterSnapshotV1,
  CoopInteractionOutcome,
} from "#data/elite-redux/coop/coop-transport";
import type { ErQuizQuestion } from "#data/elite-redux/er-quiz";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { abortActiveCoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import type { ErQuizResult } from "#phases/er-quiz-phase";
import { hideCoopControllerTag, showCoopControllerTagFor } from "#ui/coop-controller-tag";
import type { OptionSelectConfig } from "#ui/handlers/abstract-option-select-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

// #840: COOP_ME_PUMP_SEQ_BASE imported from the seq registry (was re-declared locally in 4 files).
/** Defensive ceiling: a genuinely disconnected host never hangs the guest's encounter. Mirrors
 *  the relay's "wait for the human" default (a real owner reading dialogue must not trip it). */
const COOP_ME_REPLAY_WAIT_MS = 1_200_000;

/** Routing tag for guest->host relayed ME picks (distinguishes them on the wire / in logs). */
const ME_CHOICE_KIND = "me";
/** Routing tag for guest->host relayed ME SUB-picks (party slot / secondary index). */
const ME_SUBPICK_KIND = "meSub";

/**
 * The HOST-streamed encounter presentation (#633 BLOCK-2 / P0) the guest renders off. Module-scoped
 * so {@linkcode MysteryEncounterUiHandler} can read the host's authoritative `meetsReqs` / `labels`
 * instead of its OWN diverged-party re-derivation. Non-null ONLY while a guest is mid-ME inside a
 * {@linkcode CoopReplayMePhase}; null everywhere else, so solo / host / lockstep render byte-identical.
 */
let coopMeHostPresentation: Extract<CoopInteractionOutcome, { k: "mePresent" }> | null = null;

/** Retained through detached shop/quiz/battle handoffs so a verified rejoin snapshot can finish them. */
let activeCoopReplayMePhase: CoopReplayMePhase | null = null;

// #834 (structural audit P1-1): drop the adopted presentation whenever the ME pin clears -
// including clearCoopRuntime after a mid-ME GameOver, where no ME terminal ever ran. Without
// this, a stale presentation could leak into the NEXT run's first encounter selector.
setOnMePinCleared(() => {
  coopMeHostPresentation = null;
  activeCoopReplayMePhase?.disposeRecoveryTimer();
  activeCoopReplayMePhase = null;
});

/**
 * Accessor for the host-streamed ME presentation (#633 BLOCK-2 / P0). Returns the stored blob while
 * the guest is mid-ME, else null. The ME UI handler gates its ADD-4 read on this being non-null, so
 * solo / host-owned / lockstep paths return null + render byte-identical.
 */
export function getCoopMeHostPresentation(): Extract<CoopInteractionOutcome, { k: "mePresent" }> | null {
  return coopMeHostPresentation;
}

/**
 * Set the host-streamed ME presentation. Production sets it inline in {@linkcode CoopReplayMePhase}
 * (and clears it at the terminal); this exported setter exists ONLY for the two-engine duo test
 * harness's per-client ME-state save/restore, so the guest's mid-ME presentation never bleeds into the
 * host's process-global context (and vice-versa) when the scheduler swaps clients.
 */
export function setCoopMeHostPresentation(
  presentation: Extract<CoopInteractionOutcome, { k: "mePresent" }> | null,
): void {
  coopMeHostPresentation = presentation;
}

/** Two-engine harness context seam; production has one module graph and never calls these. */
export function getActiveCoopReplayMePhaseForHarness(): CoopReplayMePhase | null {
  return activeCoopReplayMePhase;
}

/** Restore the active replay pointer after the harness swaps this client's process-global ME state in. */
export function setActiveCoopReplayMePhaseForHarness(phase: CoopReplayMePhase | null): void {
  activeCoopReplayMePhase = phase;
}

/**
 * #829 co-op COLOSSEUM between-rounds seam (GENERIC - this phase never learns about the Colosseum).
 * The Colosseum (#439) is a MULTI-battle press-your-luck gauntlet ME: after each won round a
 * CONTINUE / CASH-OUT board opens and (on CONTINUE) the NEXT round's battle spawns - each round is a
 * host-authoritative ME-battle handoff. The guest boots round 1 exactly like any battle-handoff ME
 * ({@linkcode CoopReplayMePhase.finishWithoutLeaving} below), but the TRUE ME-end LEAVE only fires
 * when the WHOLE gauntlet ends, so mid-gauntlet the guest's detached 9M-await never resolves and the
 * guest strands after round 1 (the completed round-1 battle). This delegate lets a colosseum-aware
 * driver (registered from `coop-colosseum.ts`) claim the terminal at the round-1 handoff and drive the
 * whole between-rounds loop + the eventual leave/advance itself: a `true` return means "the delegate
 * owns the terminal now" and this phase SKIPS its default detached leave+advance arm. `ctx.relay` is
 * the (non-null) live interaction relay; `ctx.seqTerm` is the 9M terminal seq the delegate races the
 * per-round board against; `ctx.interactionCounter` is the pinned ME counter. Every non-colosseum ME
 * returns `false` (the delegate self-gates on its own encounter type), so the arm below stays
 * byte-identical.
 */
export type CoopMeBattleEndDelegate = (ctx: {
  interactionCounter: number;
  seqTerm: number;
  relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>;
}) => boolean;

/**
 * #829: the between-rounds battle-end delegate, or null (the default). Set by `coop-colosseum.ts`;
 * consulted in {@linkcode CoopReplayMePhase.finishWithoutLeaving}'s detached-terminal block. When null
 * (solo + every non-colosseum ME) the hook is BYTE-IDENTICAL to the pre-#829 code. Kept module-scoped
 * + self-gated inside the delegate on the colosseum encounter type, so it can never engage for any
 * other ME even while registered (the "never leaks into other MEs" guarantee).
 */
let coopMeBattleEndDelegate: CoopMeBattleEndDelegate | null = null;
let coopMeSnapshotRebindDelegate: ((snapshot: CoopActiveMysteryEncounterSnapshotV1) => void) | null = null;

/** #829: register (d) or clear (null) the between-rounds battle-end delegate. */
export function setCoopMeBattleEndDelegate(d: CoopMeBattleEndDelegate | null): void {
  coopMeBattleEndDelegate = d;
}

/** Register a surface-specific recovery driver without teaching the generic replay phase its rules. */
export function setCoopMeSnapshotRebindDelegate(
  delegate: ((snapshot: CoopActiveMysteryEncounterSnapshotV1) => void) | null,
): void {
  coopMeSnapshotRebindDelegate = delegate;
}

/**
 * #818: the QUIZ variant of the host-streamed `mePresent` sub-prompt (the embedded Guessing Booth /
 * Scrambled Pokedex / footprint hunt / Unown cipher / braille seal / Salvage Yard). Derived from the
 * FROZEN wire union so it tracks {@linkcode CoopInteractionOutcome} without re-declaring the shape;
 * its `questions` are structurally the {@linkcode ErQuizQuestion}s the guest feeds its mirror
 * ErQuizPhase. Resolves to `never` until the transport union gains the `{ kind: "quiz"; ... }` variant.
 */
type CoopMeQuizSubPrompt = Extract<
  NonNullable<Extract<CoopInteractionOutcome, { k: "mePresent" }>["subPrompt"]>,
  { kind: "quiz" }
>;

/**
 * Co-op GUEST mystery-encounter REPLAY (#633, TRACK-2 Phase C, NON-BATTLE ME path). In the
 * AUTHORITATIVE netcode the guest's ME engine/RNG is diverged from the host's, so the guest must
 * NOT run the encounter engine: its {@linkcode MysteryEncounterPhase.start} diverts here INSTEAD of
 * running `clearPhaseQueue` / `updateSeedOffset` / the option-select UI. This phase is a pure
 * renderer + choice-forwarder:
 *  - The HOST is the sole ME engine. It streams narration (the ME message channel), the authoritative
 *    PRESENTATION (P0: dialogue tokens + per-option enablement + labels), reward options (the reward
 *    alternation), and a comprehensive terminal outcome (P4: party / save / RNG / dex) so the guest's
 *    screen + state match.
 *  - When the GUEST OWNS this ME, the guest renders the REAL option selector off the host presentation,
 *    captures the human's pick + each sub-pick on its OWN local capture screens, and RELAYS them to the
 *    host (the sole engine). It then awaits the host's comprehensive outcome before the leave terminal.
 *  - When the HOST owns it, the guest is a pure renderer: it awaits the comprehensive outcome then the
 *    leave terminal (the host already applied the rewards/side effects via the streams).
 *
 * A battle-spawning ME forwards {@linkcode COOP_ME_BATTLE_HANDOFF} instead of a leave: this phase
 * ends WITHOUT leaving so the existing host-authoritative ME-battle path runs (the guest adopts the
 * host's boss and replays the spawned battle exactly like a normal battle via the battle relay).
 *
 * EVERY await has a defensive timeout, but timeout/null is never a host decision: the guest holds the
 * exact pinned surface, re-requests the durable tail, and may exit only on a real 9M/journal terminal or
 * checksum-verified active-control snapshot. A single `settled` terminal guarantees the exact leave runs
 * once (so the outcome await + leave-sentinel await never double-leave).
 *
 * Three DISJOINT seq channels (never await the same `(inbox, seq)` for two purposes):
 *  - `seq_me = 8_000_000 + interactionCounter`: guest->host picks (P1) + sub-picks (P1b, FIFO) on the
 *    CHOICE inbox; host->guest presentation (P0) + comprehensive outcome (P4) on the OUTCOME inbox.
 *  - `seq_term = 9_000_000 + interactionCounter`: host->guest LEAVE / battle-handoff terminal (P5/P6).
 */
/** #818 latent-race fix: the 9M terminal arm a re-armed race INHERITS instead of re-awaiting.
 * A buffered LEAVE consumed by the ORIGINAL race's arm would otherwise be gone forever - the
 * re-armed await would park on an emptied inbox and the guest would never leave/advance. */
type MeTerminalArm = Promise<{
  tag: "terminal";
  action: Awaited<ReturnType<NonNullable<ReturnType<typeof getCoopInteractionRelay>>["awaitInteractionChoice"]>>;
}>;

/**
 * The embedded-shop edge participates in the same ordered replay pump as ME presentations. Reward stock
 * can be retained before a reconnecting guest installs this phase, but it must not jump ahead of already
 * buffered quiz/repeated-round presentations that causally precede the shop.
 */
type MeShopArm = Promise<{ tag: "shop"; key: string }>;

type CoopMeBattleDestination = Extract<CoopMeTerminalPayload["destination"], { kind: "battle" }>;
type CoopMeContinueDestination = Extract<CoopMeTerminalPayload["destination"], { kind: "continue" }>;

export class CoopReplayMePhase extends Phase {
  public readonly phaseName = "CoopReplayMePhase";

  private readonly interactionCounter: number;
  /** Guest->host pick / sub-pick + host->guest present / outcome channel (`8_000_000 + counter`). */
  private readonly seq: number;
  /** Host->guest terminal / battle-handoff channel (`9_000_000 + counter`), disjoint from {@linkcode seq}. */
  private readonly seqTerm: number;
  /** Set in {@linkcode leaveDefensive} / {@linkcode finishWithoutLeaving} so the terminal runs exactly once. */
  private settled = false;
  /** Unsubscribe from the host's ME narration channel (dropped at the terminal). */
  private offMeMessage: (() => void) | null = null;
  /** Bounded backoff for a missing/delayed terminal; null is never interpreted as a host leave. */
  private terminalRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalRecoveryAttempt = 0;
  /** Prevent repeated snapshots from reopening the same already-rebound sub-picker. */
  private lastSnapshotPresentationKey: string | null = null;
  /** Once-only guard for the TRUE leave arriving after an ME-spawned battle. */
  private detachedBattleEndCompleted = false;
  /** Initial top-level selector ownership/race is entered once, even if raw + snapshot presentations race. */
  private initialPresentationEntered = false;
  private boundRuntime: ReturnType<typeof getCoopRuntime> = null;
  private boundController: ReturnType<typeof getCoopController> = null;
  private boundGeneration = -1;
  private boundScene: typeof globalScene | null = null;
  /** Once-resolved shop edge, inherited by every outcome-pump re-arm just like the terminal arm. */
  private liveShopArm: MeShopArm | undefined;

  /** Exact scene/runtime/controller/generation/replay/pin fence for every detached UI continuation. */
  private boundaryStillLive(): boolean {
    return (
      this.boundScene === globalScene
      && activeCoopReplayMePhase === this
      && getCoopRuntime() === this.boundRuntime
      && getCoopController() === this.boundController
      && coopSessionGeneration() === this.boundGeneration
      && coopMeInteractionStartValue() === this.interactionCounter
    );
  }

  private openModeBounded(mode: UiMode, ...args: unknown[]): Promise<"completed" | "forced" | "superseded"> {
    return globalScene.ui.setModeBoundedWhen(mode, 2_000, () => this.boundaryStillLive(), ...args);
  }

  constructor(interactionCounter: number) {
    super();
    this.interactionCounter = interactionCounter;
    this.seq = COOP_ME_PUMP_SEQ_BASE + interactionCounter;
    this.seqTerm = COOP_ME_TERM_SEQ_BASE + interactionCounter;
    this.boundRuntime = getCoopRuntime();
    this.boundController = getCoopController();
    this.boundGeneration = coopSessionGeneration();
    this.boundScene = globalScene;
  }

  public override start(): void {
    super.start();
    activeCoopReplayMePhase = this;
    this.boundRuntime = getCoopRuntime();
    this.boundController = getCoopController();
    this.boundGeneration = coopSessionGeneration();
    this.boundScene = globalScene;
    coopLog("me", "guest diverted into CoopReplayMePhase", {
      counter: this.interactionCounter,
      seqMe: this.seq,
      seqTerm: this.seqTerm,
      wave: globalScene.currentBattle?.waveIndex,
    });
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      // Missing transport authority is not evidence that the host left this encounter. Hold the exact
      // phase; the session-level reconnect/termination path decides whether play resumes or returns home.
      coopWarn("me", "no interaction relay at ME start; holding for session recovery", {
        counter: this.interactionCounter,
      });
      return;
    }
    if (isCoopMeOperationJournalActive()) {
      // A fast host can commit the complete terminal before this replay surface is installed (notably an
      // embedded shop/outro). Its first delivery correctly remains unacknowledged because the destination
      // was not executable yet. Announce the now-live receiver immediately instead of waiting for the
      // periodic resend ceiling; the retained exact tail then materializes on this scene/context.
      this.boundRuntime?.durability?.reconnect();
    }
    // Render the host's authoritative ME narration as it arrives (cosmetic; the outcome rides the
    // reward alternation + the comprehensive P4 resync, so a dropped line can never desync). Dropped
    // at the terminal in leaveDefensive / finishWithoutLeaving.
    this.offMeMessage =
      getCoopBattleStreamer()?.onMeMessage(text => {
        if (!this.boundaryStillLive()) {
          return;
        }
        try {
          // #816: render DIRECTLY - queued messages never display while this phase is
          // parked awaiting the host, which is exactly when narration arrives.
          // #817: the ME selector handler HAS a message area (showText routes into it),
          // so narration renders inside the encounter window instead of overdrawing it.
          globalScene.ui.showText(text, null, undefined, null, true);
        } catch {
          /* a narration render failure must never hang the guest's encounter */
        }
      }) ?? null;

    // #821 SHOP HANDOFF (live 'the reward shop doesn't load for the other player'): a
    // non-battle ME's embedded reward shop's OPTION list is always rolled + streamed by the
    // HOST engine; its streamed rewardOptions used to buffer with no waiter while this phase
    // parked in the ME await - the guest never saw a shop AND its wave-end chain (driven by
    // its own shop phase) never ran, stranding it after the ME. When the options arrive (or
    // already sit buffered), settle this phase and run the guest's OWN SelectModifierPhase.
    // #828: that phase resolves its role from the ME OWNER - on a HOST-owned ME the guest
    // WATCHES the host's picks; on a GUEST-owned ME the guest DRIVES the pick as OWNER
    // (adopting the host's streamed options) and relays it, the host applies. Either way a
    // DETACHED terminal listener handles the eventual ME end (leave + advance), as the :46 flow did.
    const shopKeyPrefix = `${this.interactionCounter}:`;
    // #830: capture the registering client's scene. In the two-engine duo harness a loopback
    // delivery microtask can flush while globalScene points at the OTHER client; opening this
    // guest's shop against the wrong scene would corrupt the host's phase queue. In production
    // each client is its own realm, so the guard never fires; in the harness the buffered options
    // stay in the inbox and the fast-path check on the next same-scene entry picks them up.
    const registeringScene = globalScene;
    let resolveShopArm: ((value: { tag: "shop"; key: string }) => void) | null = null;
    this.liveShopArm = new Promise(resolve => {
      resolveShopArm = resolve;
    });
    let shopEdgeRetained = false;
    relay.onRewardOptionsBuffered = key => {
      if (!this.boundaryStillLive()) {
        return;
      }
      if (!String(key).startsWith(shopKeyPrefix)) {
        return;
      }
      if (globalScene !== registeringScene) {
        coopLog("me", "shop-handoff notification under a foreign scene (harness ctx); deferring", { key });
        return;
      }
      if (shopEdgeRetained) {
        return;
      }
      shopEdgeRetained = true;
      coopLog("me", "embedded reward-shop edge retained behind the ME presentation pump", { key });
      // The real guest-owner UI normally arms the outcome/terminal pump before its selection is
      // relayed. A restored selector (and the two-browser faithful split driver) can instead send the
      // pick first, then re-enter here with no race armed. If no earlier presentation is buffered, this
      // shop is the next executable surface and must be materialized directly. When an earlier outcome
      // exists, retain the shop edge so the ordered pump below drains that outcome first.
      if (
        this.initialPresentationEntered
        && !this.raceArmed
        && this.canLocalPlayerSelect()
        && !relay.hasBufferedInteractionOutcomeFor(this.seq)
      ) {
        coopLog("me", "guest-owned reward shop is next executable surface; materializing retained edge", { key });
        this.handleEmbeddedShopHandoff(relay, key);
        return;
      }
      resolveShopArm?.({ tag: "shop", key });
      resolveShopArm = null;
    };
    // The option carrier can beat this phase during a slow guest transition/rejoin. The relay retains
    // that carrier, but assigning a callback does not replay an already-buffered notification. Without
    // this admission the guest waits forever on the ME surface while the host is already parked at the
    // reciprocal shop barrier. Treat the retained inbox as an edge-trigger that already happened; the
    // shop opener consumes the same buffered options and still performs every normal authority check.
    if (relay.hasBufferedRewardOptionsFor(shopKeyPrefix)) {
      coopLog("me", "reward shop handoff was buffered before replay listener; admitting retained edge", {
        counter: this.interactionCounter,
      });
      relay.onRewardOptionsBuffered(shopKeyPrefix);
    }
    this.awaitHostPresentationThenEnter(relay);
  }

  /**
   * Materialize the retained shop edge only after every already-buffered ME presentation ahead of it has
   * won the replay race. This keeps slow/rejoining clients on the causal UI order: selector rounds, quiz,
   * then reward shop.
   */
  private handleEmbeddedShopHandoff(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>, key: string): void {
    if (!this.boundaryStillLive()) {
      return;
    }
    // #860 (Professor quiz stuck, sibling of #859): dissolve only when the shop actually becomes the
    // executable surface. Doing it on carrier arrival could preempt buffered quiz/repeated-round surfaces.
    if (!coopMeHandoffBattleStarted()) {
      abortActiveCoopReplayTurnPhase("ME embedded-shop handoff (#860)");
    }
    if (this.settledDetached) {
      if (!this.shopHandedOff) {
        this.shopHandedOff = true;
        coopLog("me", "reward shop FOLLOWS the quiz handoff - opening guest ME-owner-role shop directly (#818/#828)", {
          counter: this.interactionCounter,
          key,
        });
        openGuestMeEmbeddedShop(this.interactionCounter);
      }
      return;
    }
    if (!this.settled) {
      this.settleForWatcherShop(relay);
    }
  }

  /** Await and adopt the exact host selector; a null/malformed result re-requests control, never re-derives. */
  private awaitHostPresentationThenEnter(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    void (async () => {
      coopLog("me", "await host presentation (mePresent)", {
        seq: this.seq,
        timeoutMs: COOP_ME_REPLAY_WAIT_MS,
      });
      const present = await relay.awaitInteractionOutcome(this.seq, COOP_ME_REPLAY_WAIT_MS);
      if (!this.boundaryStillLive()) {
        return;
      }
      if (present == null || present.k !== "mePresent") {
        if (this.initialPresentationEntered) {
          return; // a verified snapshot already supplied + entered this selector
        }
        coopWarn("me", "presentation await resolved without authoritative mePresent; holding exact screen", {
          seq: this.seq,
          got: present == null ? "null" : present.k,
        });
        this.recoverMissingControl("missing presentation", () => this.awaitHostPresentationThenEnter(relay));
        return;
      }
      const enc = globalScene.currentBattle.mysteryEncounter;
      if (enc != null) {
        enc.dialogueTokens = { ...enc.dialogueTokens, ...present.tokens };
        coopMeHostPresentation = present;
      }
      coopLog("me", "adopted host presentation", {
        seq: this.seq,
        opts: present.meetsReqs.length,
        labels: present.labels.length,
        tokens: Object.keys(present.tokens).length,
      });

      if (this.initialPresentationEntered) {
        return; // verified snapshot already rebound this same initial selector
      }
      this.initialPresentationEntered = true;

      if (this.settled && this.settledDetached && !this.raceArmed) {
        this.awaitOutcomeThenTerminal(relay);
        return;
      }
      if (this.settled) {
        return;
      }
      const ownsMe = getCoopController()?.isLocalOwnerAtCounter(this.interactionCounter) ?? false;
      coopLog("me", "ME ownership resolved", {
        counter: this.interactionCounter,
        ownsMe,
        branch: ownsMe ? "guest renders selector + relays picks" : "pure renderer (await outcome+terminal)",
      });
      showCoopControllerTagFor(ownsMe);
      void this.openModeBounded(UiMode.MYSTERY_ENCOUNTER, undefined);
      if (!ownsMe) {
        this.awaitOutcomeThenTerminal(relay);
      }
    })();
  }

  /**
   * GUEST-OWNED ME top-level pick (#633 BLOCK-3): relay the chosen option INDEX to the host (the sole
   * engine), then drive the sub-pick loop + await the host's authoritative outcome + leave terminal.
   * View-party (cursor === viewPartyIndex) is handled locally in the UI handler and never reaches here.
   */
  /** #815: one top-level pick per ME - a double-fired select must not re-arm the awaits. */
  private pickSent = false;
  /** Distinct durable address for every repeated Delve/Safari selector on this pinned ME. */
  private pickStep = 0;

  /**
   * Whether this replay client owns the pinned ME and may originate option input. This is intentionally
   * public so the UI handler can fail closed before accepting cursor/action input; the owner check is
   * repeated in handleGuestOptionSelect as a second boundary against stale callbacks or future UI leaks.
   */
  public canLocalPlayerSelect(): boolean {
    return this.boundaryStillLive() && (getCoopController()?.isLocalOwnerAtCounter(this.interactionCounter) ?? false);
  }

  /**
   * #821/#818: settled via a DETACHED handoff (the embedded reward SHOP or the embedded QUIZ) - the
   * phase ended but the ME is still live on the owner, so the terminal must still run the leave +
   * advance duties. Generalizes the former `settledForShop`: the three shop-aware race guards + the
   * leaveDefensive duty branch key off THIS for BOTH handoffs.
   */
  private settledDetached = false;

  /**
   * #818: the watcher reward shop is opened at most ONCE - by settleForWatcherShop (the shop-only
   * handoff), or (when a reward shop FOLLOWS a quiz handoff) directly by the rewardOptions hook.
   */
  private shopHandedOff = false;

  /** #821: whether awaitOutcomeThenTerminal has been armed at least once. */
  private raceArmed = false;

  /**
   * #831 (audit P0#1): the SINGLE live 9M terminal arm, INHERITED by every re-arm (a repeated-option-select
   * round re-render OR the quiz handoff) instead of re-awaited on the 9M inbox. A LEAVE the ORIGINAL arm
   * already buffer-consumed (fast host, lagging guest) would be lost to a fresh await on the emptied inbox
   * and the guest would never leave/advance (the #818 latent race, generalized to N re-arms).
   */
  private liveTerminalArm: MeTerminalArm | undefined;
  /** Journal mode never consumes raw 9M; the retained transaction calls the phase directly. */
  private journalTerminalArm: MeTerminalArm | undefined;

  /**
   * #831 (audit P0#1, GROUP REPEAT): how many REPEATED option-select rounds (each a bare re-fired mePresent
   * with NO subPrompt) this phase re-rendered AFTER the initial presentation. 0 for a single-round ME; N for
   * an (N+1)-round press-your-luck delve / Safari loop. A duo-harness test seam (read via the established
   * `as unknown as {...}` cast, like `settled`).
   */
  private newRoundsRendered = 0;

  /** Explicit accepted terminal causality; never infer a prior battle from generic settled flags. */
  private acceptedTerminal:
    | { kind: "pending" }
    | {
        kind: "battle-handoff" | "leave";
        operationId: string;
        step: number;
        revision: number;
      } = {
    kind: "pending",
  };
  private retryableBattleTerminalOperationId: string | null = null;

  public handleGuestOptionSelect(index: number): void {
    if (!this.canLocalPlayerSelect()) {
      coopWarn("me", "watcher option select IGNORED (pinned ME belongs to partner)", {
        counter: this.interactionCounter,
        index,
      });
      return;
    }
    if (this.pickSent) {
      coopWarn("me", "DUPLICATE guest option select IGNORED (#815 re-entry guard)", {
        counter: this.interactionCounter,
        index,
      });
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      coopWarn("me", "no relay on guest option select; holding committed UI state for session recovery", {
        counter: this.interactionCounter,
        index,
      });
      return;
    }
    const step = this.pickStep;
    const operationId = commitMeOwnerIntent({
      kind: "ME_PICK",
      seq: this.seq,
      pinned: this.interactionCounter,
      step,
      payload: { optionIndex: index },
      localRole: getCoopController()?.role ?? "guest",
      wave: globalScene.currentBattle?.waveIndex ?? -1,
      turn: 0,
      resend: isCoopMeOperationJournalActive()
        ? () => relay.sendInteractionChoice(this.seq, ME_CHOICE_KIND, index, [step])
        : undefined,
    });
    if (operationId == null && isCoopMeOperationEnabled()) {
      failCoopSharedSession(`Mystery pick ${this.seq}/${step} could not enter authoritative control`);
      return;
    }
    this.pickStep = step + 1;
    this.pickSent = true;
    // #819 ('the selection screen doesn't disappear'): the pick is committed - dismiss the
    // option UI so narration renders in a clean message box, mirroring the engine side.
    void this.openModeBounded(UiMode.MESSAGE);
    coopLog("me", "guest relays top-level ME pick", {
      seq: this.seq,
      kind: ME_CHOICE_KIND,
      index,
    });
    relay.sendInteractionChoice(this.seq, ME_CHOICE_KIND, index, [step]); // P1 on seq_me; stable proposal ordinal
    // #831: for a REPEATED option-select round (delve / Safari) beginNewRound reset pickSent so THIS pick is
    // allowed, and this re-armed race INHERITS the live 9M terminal arm (awaitOutcomeThenTerminal reads
    // this.liveTerminalArm) rather than re-awaiting the inbox - a fast host's buffered LEAVE is never lost.
    this.awaitOutcomeThenTerminal(relay);
  }

  /**
   * GUEST-OWNED ME sub-pick (#633 BLOCK-3): a party-target slot or a secondary-option index. Relayed on
   * the SAME seq_me (CHOICE inbox, FIFO); the host consumes one per sub-prompt site (ADD-2b).
   */
  /** Wave-2c: monotonic sub-pick ordinal within this ME (party/secondary/catch-full sub-picks FIFO on seq_me),
   *  so every sub-pick of the SAME ME mints a DISTINCT ME_SUB operationId (the multi-step delta over biome). */
  private subPickStep = 0;

  /** One exact committed ME_PRESENT sub-prompt may originate at most one owner intent. */
  private readonly subPromptIntentGate = new CoopMePresentationIntentGate();
  private legacySubPromptOrdinal = 0;

  private bindSubPromptPresentation(present: Extract<CoopInteractionOutcome, { k: "mePresent" }>): string | null {
    let identity: string;
    if (isCoopMeOperationJournalActive()) {
      const control = captureCoopActiveMysteryControl();
      if (
        control == null
        || control.interactionCounter !== this.interactionCounter
        || control.terminal !== "pending"
        || control.presentation == null
        || JSON.stringify(control.presentation) !== JSON.stringify(present)
      ) {
        failCoopSharedSession(`Mystery sub-prompt ${this.seq} did not match retained presentation control`);
        return null;
      }
      identity = `${control.revision}:${control.round}:${JSON.stringify(present.subPrompt)}`;
    } else {
      identity = `legacy:${this.legacySubPromptOrdinal++}:${JSON.stringify(present.subPrompt)}`;
    }
    if (!this.subPromptIntentGate.bind(identity)) {
      return null; // duplicate carrier/rebind of the same committed presentation never rearms input
    }
    return identity;
  }

  private subPromptTicketLive(identity: string): boolean {
    return this.boundaryStillLive() && this.subPromptIntentGate.canSubmit(identity);
  }

  public relayGuestSubPick(value: number, presentationIdentity?: string): boolean {
    coopLog("me", "guest relays ME sub-pick", {
      seq: this.seq,
      kind: ME_SUBPICK_KIND,
      value,
    });
    const exactPresentation = presentationIdentity ?? this.subPromptIntentGate.currentIdentity();
    if (exactPresentation == null) {
      return false;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null || !this.subPromptTicketLive(exactPresentation)) {
      return false;
    }
    // Claim before commit/raw send. A second callback from the same party/menu UI is a no-op even if it
    // fires synchronously in this frame.
    if (!this.subPromptIntentGate.claim(exactPresentation)) {
      return false;
    }
    const step = this.subPickStep;
    // Wave-2c: DUAL-RUN - mint the typed ME_SUB intent (the guest owner's captured slot/index). The step
    // ordinal disambiguates repeated sub-picks that FIFO on the same seq. No-op when the flag is OFF.
    const operationId = commitMeOwnerIntent({
      kind: "ME_SUB",
      seq: this.seq,
      pinned: this.interactionCounter,
      step,
      payload: { value },
      localRole: getCoopController()?.role ?? "guest",
      wave: globalScene.currentBattle?.waveIndex ?? -1,
      turn: 0,
      resend: isCoopMeOperationJournalActive()
        ? () => relay.sendInteractionChoice(this.seq, ME_SUBPICK_KIND, value, [step])
        : undefined,
    });
    if (operationId == null && isCoopMeOperationEnabled()) {
      failCoopSharedSession(`Mystery sub-pick ${this.seq}/${step} could not enter authoritative control`);
      return false;
    }
    this.subPickStep = step + 1;
    relay.sendInteractionChoice(this.seq, ME_SUBPICK_KIND, value, [step]); // stable proposal ordinal
    return true;
  }

  /**
   * Drive the host's outcome channel for this ME (#633, both ownership paths). The host's sole engine
   * reaches each sub-prompt and streams a `mePresent` carrying a `subPrompt` descriptor right before it
   * opens that sub-screen; the guest opens the matching LOCAL capture screen, relays the pick, and loops
   * (FIFO on seq_me / outcome). When the host instead streams the comprehensive `meResync` (its ME
   * terminal), the guest applies it and proceeds to the leave terminal.
   *
   * MAJOR-2 (#633 softlock #693/#698): NOT every host ME terminal is preceded by a `meResync` on
   * seq_me. A battle-spawning option ({@linkcode CoopMePump.relayMeBattleHandoff}) and the host's
   * degrade paths ({@linkcode coopHostAwaitGuestIndex} null / out-of-range / bespoke sub-UI) fire the
   * TERMINAL sentinel (LEAVE / battle-handoff) on `seq_term` (9M) WITHOUT ever streaming a `meResync`
   * on `seq_me` (8M). If we awaited ONLY the 8M outcome here we would block forever while the terminal
   * sat unconsumed on 9M (the live freeze: the guest parked on `awaitInteractionOutcome(8M)` while the
   * host's `meBtn` picks buffered on the 8M CHOICE inbox, never the OUTCOME inbox we read). So we RACE
   * the next 8M outcome against the 9M terminal:
   *  - 8M outcome wins (sub-prompt -> capture+loop; `meResync` -> apply+loop to the terminal).
   *  - 9M terminal wins (LEAVE / battle-handoff) -> resolve it directly; null enters recovery,
   *    NO `meResync` required (the next per-ME / per-turn checksum re-syncs any residual numeric drift,
   *    exactly as the prior null-host-stall fall-through already did).
   * The single `settled` guard fires the terminal exactly once; whichever arm loses is ignored.
   */
  private awaitOutcomeThenTerminal(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    inheritedTerminalArm?: MeTerminalArm,
  ): void {
    this.raceArmed = true;
    coopLog("me", "await host outcome (mePresent subPrompt / meResync) racing terminal", {
      seq: this.seq,
      seqTerm: this.seqTerm,
      timeoutMs: COOP_ME_REPLAY_WAIT_MS,
    });
    // Two disjoint inboxes (8M OUTCOME vs 9M CHOICE), so the awaits never cross-consume. We start BOTH
    // awaits now (each drains its own buffer synchronously) and race them. Key properties:
    //  - The OUTCOME arm is raced FIRST so it WINS a both-buffered tie: when the host streamed a
    //    meResync AND the terminal before the guest got here, we surface + apply the meResync rather
    //    than skipping straight to leave. When only the terminal is buffered, it wins uncontested.
    //  - Starting the terminal arm CONSUMES a buffered 9M terminal even if the outcome arm wins, so we
    //    must NOT re-await 9M afterwards (that would block on an already-drained inbox). Instead, when an
    //    outcome wins and we still need the terminal (after a meResync), we `await terminalArm` itself -
    //    its (already-consumed) value - so nothing is lost. On a subPrompt win the terminal has not been
    //    sent yet, so terminalArm stays pending; the next loop's fresh race supersedes it (the dangling
    //    waiter resolves null, dropped by its own raceDone).
    let raceDone = false;
    // Promise.race array order only breaks ties between promises that are already settled. A buffered
    // relay outcome still passes through the mapping microtask below, so an already-settled later shop
    // edge can otherwise win first. Snapshot the inbox before consuming it and exclude that later edge
    // from this race when causal history says the buffered outcome must be presented next.
    const bufferedOutcomeMustWin = relay.hasBufferedInteractionOutcomeFor(this.seq);
    const outcomeArm = relay
      .awaitInteractionOutcome(this.seq, COOP_ME_REPLAY_WAIT_MS)
      .then(outcome => ({ tag: "outcome" as const, outcome }));
    // #818/#831 latent-race fix: a re-arm (quiz handoff OR a repeated-option-select ROUND) INHERITS the ONE
    // live 9M terminal arm rather than re-awaiting the inbox. The original arm may have ALREADY buffer-hit
    // the host's LEAVE (fast host, lagging guest); re-awaiting the emptied 9M inbox would hang forever and
    // the guest would never leave/advance. Priority: an explicitly-passed arm (the quiz handoff threads it),
    // else the stored live arm (new-round re-renders + the owner's per-round pick relay reuse it), else a
    // fresh await (the FIRST race of the ME). Stored back so handleGuestOptionSelect and beginNewRound both
    // reuse the identical promise across every round.
    const terminalArm: MeTerminalArm =
      inheritedTerminalArm
      ?? this.liveTerminalArm
      ?? (isCoopMeOperationJournalActive()
        ? (this.journalTerminalArm ??= new Promise(() => {}))
        : relay
            .awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS, COOP_ME_TERMINAL_CHOICE_KINDS)
            .then(action => ({
              tag: "terminal" as const,
              action,
            })));
    this.liveTerminalArm = terminalArm;
    if (isCoopMeOperationJournalActive()) {
      // The complete terminal may already have reached this client while an embedded reward shop, quiz,
      // or sub-picker still owned the executable surface. That delivery correctly remained unacknowledged.
      // Reannounce the retained tail only after this exact replay receiver is live, so closing the nested
      // surface does not depend on a periodic resend timer before DATA+destination can complete atomically.
      this.boundRuntime?.durability?.reconnect();
    }
    // A live shop may race a genuinely live outcome, but it may not overtake an outcome that was already
    // buffered before this pump armed. Repeated rounds re-enter here and drain one FIFO item at a time.
    const raceArms =
      this.liveShopArm == null || bufferedOutcomeMustWin
        ? [outcomeArm, terminalArm]
        : [outcomeArm, this.liveShopArm, terminalArm];
    void Promise.race(raceArms).then(winner => {
      if (raceDone) {
        return;
      }
      raceDone = true;
      if (!this.boundaryStillLive()) {
        return;
      }
      if (this.settled && !this.settledDetached) {
        coopLog("me", "outcome/terminal race resolved after settled; ignoring", { seq: this.seq });
        return;
      }
      // The HOST reached its ME terminal on 9M (LEAVE / battle-handoff) WITHOUT a trailing meResync,
      // or the carrier resolved null. handleTerminalAction accepts the exact terminal and recovers null.
      if (winner.tag === "terminal") {
        coopLog("me", "terminal won the outcome/terminal race (no trailing meResync)", {
          seqTerm: this.seqTerm,
          action: winner.action == null ? "null" : winner.action.choice,
        });
        this.handleTerminalAction(winner.action);
        return;
      }
      if (winner.tag === "shop") {
        this.handleEmbeddedShopHandoff(relay, winner.key);
        return;
      }
      const outcome = winner.outcome;
      // #831 (audit P0#1, GROUP REPEAT): a re-fired TOP-LEVEL mePresent (k==="mePresent", subPrompt==null)
      // arriving on a live UNSETTLED phase is the NEXT press-your-luck / Safari ROUND (the host re-fired
      // MysteryEncounterPhase with the round's options: "descend again? / dig again?"), NOT the stray it used
      // to fall through to (:463 warn -> terminal), which softlocked the delves. Re-render exactly as start()
      // did off the fresh presentation and re-arm. Placed BEFORE the subPrompt branch (disjoint: subPrompt==null
      // vs !=null) and gated on !settled so a detached shop/quiz settle never re-opens a round.
      if (outcome != null && outcome.k === "mePresent" && outcome.subPrompt == null && !this.settled) {
        this.beginNewRound(relay, outcome, terminalArm);
        return;
      }
      if (outcome != null && outcome.k === "mePresent" && outcome.subPrompt != null) {
        // #818: the host opened its embedded QUIZ minigame (Guessing Booth / Scrambled Pokedex /
        // footprint hunt / Unown cipher / braille seal / Salvage Yard). Unlike the party/secondary
        // sub-prompts (a single slot/index capture), the quiz is a whole multi-question sub-phase
        // whose engine outcome the HOST owns. Settle DETACHED + run the guest's OWN mirror ErQuizPhase
        // (which self-relays its answers), exactly as the reward shop hands off to a watcher
        // SelectModifierPhase (#821). Handled BEFORE openSubPickCapture, which stays party/secondary-only.
        if (outcome.subPrompt.kind === "quiz") {
          coopLog("me", "host opened embedded ME quiz sub-prompt; handing off to mirror ErQuizPhase (#818)", {
            seq: this.seq,
            questions: outcome.subPrompt.questions.length,
            stopOnWrong: outcome.subPrompt.stopOnWrong,
          });
          this.settleForWatcherQuiz(relay, outcome.subPrompt, terminalArm);
          return;
        }
        // ADD-1c: the host opened an engine sub-prompt. Open the matching local capture screen, relay
        // the human's pick, and loop for the next sub-prompt / the terminal resync. (The pending
        // terminalArm is superseded by the next loop's race - harmless.)
        coopLog("me", "host opened engine sub-prompt; opening local capture", {
          seq: this.seq,
          kind: outcome.subPrompt.kind,
          labels: outcome.subPrompt.kind === "secondary" ? outcome.subPrompt.labels.length : undefined,
        });
        const presentationIdentity = this.bindSubPromptPresentation(outcome);
        if (presentationIdentity != null) {
          this.openSubPickCapture(relay, outcome.subPrompt, presentationIdentity);
        }
        return;
      }
      if (outcome != null && outcome.k === "meResync") {
        if (isCoopMeOperationJournalActive()) {
          coopWarn("me", "raw meResync ignored while the journal owns the terminal transaction", { seq: this.seq });
          void terminalArm.then(t => {
            if (this.boundaryStillLive()) {
              this.handleTerminalAction(t.action);
            }
          });
          return;
        }
        coopLog("me", "host sent comprehensive outcome (meResync); applying", {
          seq: this.seq,
        });
        if (!applyCoopMeOutcome(outcome)) {
          failCoopSharedSession(
            consumeCoopMeOutcomeRollbackFatal()
              ? `Mystery outcome ${this.seq} rollback failed`
              : `Mystery outcome ${this.seq} could not apply atomically`,
          );
          return;
        }
        // The comprehensive resync means "the host applied the option": resolve the terminal via the
        // SAME terminalArm (its terminal, if any, is already drained into it) so we never re-await an
        // emptied 9M inbox and hang. A still-pending terminalArm resolves on the real terminal / null.
        void terminalArm.then(t => {
          if (!this.settled || this.settledDetached) {
            this.handleTerminalAction(t.action);
          }
        });
        return;
      }
      // A non-subPrompt, non-resync outcome (a stray present, or a null/timeout on the OUTCOME arm
      // winning the race): resolve the terminal via the SAME terminalArm (same reasoning as the
      // meResync branch), so a LEAVE / battle-handoff already drained into it still ends the ME.
      coopWarn("me", "outcome arm resolved without subPrompt/meResync; resolving via terminal arm", {
        seq: this.seq,
        got: outcome == null ? "null" : outcome.k,
      });
      void terminalArm.then(t => {
        if (!this.settled || this.settledDetached) {
          this.handleTerminalAction(t.action);
        }
      });
    });
  }

  /**
   * #831 (audit P0#1, GROUP REPEAT): render a REPEATED option-select ROUND. The 8 press-your-luck delves
   * (Into the Caldera, Abyssal Vent, Tide Pools, Buried City, Glittering Vein, Overcharge Core, Overgrown
   * Temple, Woodland Forager) + Safari Zone re-fire MysteryEncounterPhase each round via
   * initSubsequentOptionSelect, so the HOST engine streams a FRESH top-level `mePresent` (no subPrompt) per
   * round through the same 8M sender. This mirrors {@linkcode start}'s presentation-adopt + ownership branch
   * for the NEW round: the OWNER re-opens the REAL selector + re-arms its pick relay (one pick PER ROUND);
   * the WATCHER adopts the presentation for display + re-arms the outcome/terminal race and keeps waiting.
   * The round loop ends when the host reaches its NORMAL terminal (meResync + LEAVE, or a battle handoff on a
   * bust) - all the existing terminal machinery (leaveDefensive / the meResync branch / handleTerminalAction)
   * runs UNCHANGED. Every re-arm INHERITS the live terminalArm (#818): a fast host's already-buffered LEAVE is
   * never lost to a fresh await on 9M. No-op on solo / non-delve co-op MEs (they never re-fire a bare mePresent
   * on a live phase), so those paths stay byte-identical.
   */
  private beginNewRound(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    present: Extract<CoopInteractionOutcome, { k: "mePresent" }>,
    terminalArm: MeTerminalArm,
  ): void {
    this.newRoundsRendered += 1;
    coopLog("me", "REPEATED option-select ROUND (bare mePresent, no subPrompt) - re-rendering (#831)", {
      seq: this.seq,
      round: this.newRoundsRendered,
      opts: present.meetsReqs.length,
      labels: present.labels.length,
    });
    // Adopt the fresh presentation exactly as start() does (host tokens win; the UI handler reads the round's
    // meetsReqs / labels off coopMeHostPresentation, so the watcher renders the round's real button labels).
    const enc = globalScene.currentBattle.mysteryEncounter;
    if (enc != null) {
      enc.dialogueTokens = { ...enc.dialogueTokens, ...present.tokens };
      coopMeHostPresentation = present;
    }
    const ownsMe = getCoopController()?.isLocalOwnerAtCounter(this.interactionCounter) ?? false;
    if (ownsMe) {
      // One pick PER ROUND: re-open the pick relay (the #815 single-pick guard is per-round for a repeated
      // select, not per-ME). The UI handler forwards the human's next pick to handleGuestOptionSelect, which
      // re-arms the race INHERITING this.liveTerminalArm - so we must NOT arm a race here (a second live race
      // would double-consume the host's next round outcome).
      this.pickSent = false;
      showCoopControllerTagFor(true); // #817: green = you drive this round
      void this.openModeBounded(UiMode.MYSTERY_ENCOUNTER, undefined);
      return;
    }
    // Watcher: adopt the presentation for display (the real selector, input-blocked for non-owners) + re-arm
    // the outcome/terminal race INHERITING the live terminalArm, and keep waiting for the next round / terminal.
    showCoopControllerTagFor(false); // #817: amber = partner drives this round
    void this.openModeBounded(UiMode.MYSTERY_ENCOUNTER, undefined);
    this.awaitOutcomeThenTerminal(relay, terminalArm);
  }

  /**
   * ADD-1c: open the LOCAL capture screen matching the host's streamed sub-prompt (the guest takes NO
   * engine action - it only captures the human's slot/index and relays it). After relaying, loop back to
   * {@linkcode awaitOutcomeThenTerminal} for the next sub-prompt or the terminal resync.
   */
  private openSubPickCapture(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    subPrompt: { kind: "party" } | { kind: "secondary"; labels: string[] } | { kind: "catchFull"; pokemonName: string },
    presentationIdentity: string,
  ): void {
    const restoreMode = globalScene.ui.getMode();
    if (subPrompt.kind === "catchFull") {
      // #855: an ME granted a mon while the party is full. The guest (the ME owner) drives the REAL
      // replace-or-skip decision locally and relays ONLY the chosen slot; the sole-engine host applies the
      // authoritative release+add (coopHostStreamCatchFullAwaitSlot). Show the party-full text, then open a
      // NON-mutating PARTY/SELECT picker (SELECT so the guest's pure-renderer party is never spliced locally
      // - the host owns the mutation); a cancel relays an out-of-range slot, and the host skips the grant.
      const pokemonName = subPrompt.pokemonName;
      coopLog("me", "opening local catch-FULL replace-or-skip capture (#855)", {
        seq: this.seq,
        restoreMode,
      });
      globalScene.ui.showText(i18next.t("battle:partyFull", { pokemonName }), null, () => {
        if (!this.subPromptTicketLive(presentationIdentity)) {
          return;
        }
        void this.openModeBounded(UiMode.PARTY, PartyUiMode.SELECT, -1, (slotIndex: number) => {
          if (!this.subPromptTicketLive(presentationIdentity)) {
            return;
          }
          coopLog("me", "captured catch-full replace slot (#855)", {
            seq: this.seq,
            slotIndex,
          });
          void this.openModeBounded(restoreMode).then(opened => {
            if (opened === "superseded" || !this.subPromptTicketLive(presentationIdentity)) {
              return;
            }
            if (this.relayGuestSubPick(slotIndex, presentationIdentity)) {
              this.awaitOutcomeThenTerminal(relay);
            }
          });
        });
      });
      return;
    }
    if (subPrompt.kind === "party") {
      coopLog("me", "opening local PARTY sub-pick capture", {
        seq: this.seq,
        restoreMode,
      });
      // Party target: open the same PARTY/SELECT screen the host's selectPokemonForOption opens, capture
      // the chosen slot, relay it, and loop. The callback takes no engine action (the host's engine
      // resolves the target authoritatively from the relayed slot).
      void this.openModeBounded(UiMode.PARTY, PartyUiMode.SELECT, -1, (slotIndex: number) => {
        if (!this.subPromptTicketLive(presentationIdentity)) {
          return;
        }
        coopLog("me", "captured party sub-pick slot", {
          seq: this.seq,
          slotIndex,
        });
        void this.openModeBounded(restoreMode).then(opened => {
          if (opened === "superseded" || !this.subPromptTicketLive(presentationIdentity)) {
            return;
          }
          if (this.relayGuestSubPick(slotIndex, presentationIdentity)) {
            this.awaitOutcomeThenTerminal(relay);
          }
        });
      });
      return;
    }
    coopLog("me", "opening local SECONDARY sub-pick capture", {
      seq: this.seq,
      labels: subPrompt.labels.length,
      restoreMode,
    });
    // Secondary menu: open a MESSAGE-mode OPTION_SELECT list with the HOST-streamed labels, capture the
    // chosen index, relay it, and loop. A cancel option relays the out-of-range "not selected" index.
    const labels = subPrompt.labels;
    void this.openModeBounded(UiMode.MESSAGE).then(opened => {
      if (opened === "superseded" || !this.boundaryStillLive()) {
        return;
      }
      const options = labels.map((label, idx) => ({
        label,
        handler: () => {
          this.captureSecondaryPick(relay, restoreMode, idx, presentationIdentity);
          return true;
        },
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          // Out-of-range index => the host runs the option's not-selected / default branch.
          this.captureSecondaryPick(relay, restoreMode, labels.length, presentationIdentity);
          return true;
        },
      });
      const config: OptionSelectConfig = { options, maxOptions: 7, yOffset: 0 };
      void this.openModeBounded(UiMode.OPTION_SELECT, config, null, true);
    });
  }

  /** ADD-1c secondary-menu helper: restore the prior mode, relay the chosen index, loop. */
  private captureSecondaryPick(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    restoreMode: UiMode,
    index: number,
    presentationIdentity: string,
  ): void {
    coopLog("me", "captured secondary sub-pick index", {
      seq: this.seq,
      index,
    });
    if (!this.subPromptTicketLive(presentationIdentity)) {
      return;
    }
    globalScene.ui.clearText();
    void this.openModeBounded(restoreMode).then(opened => {
      if (opened === "superseded" || !this.subPromptTicketLive(presentationIdentity)) {
        return;
      }
      if (this.relayGuestSubPick(index, presentationIdentity)) {
        this.awaitOutcomeThenTerminal(relay);
      }
    });
  }

  /**
   * Await the host's authoritative ME terminal on the interaction relay (the LEAVE sentinel) or the
   * battle-handoff sentinel, on the DEDICATED terminal seq (`9_000_000 + counter`, disjoint from the
   * pick/outcome seq). A null is transport recovery, never an encounter exit.
   */
  private awaitHostTerminal(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    if (isCoopMeOperationJournalActive()) {
      // The complete retained transaction calls `applyCommittedTerminalTransaction` synchronously. A raw
      // waiter here would consume compatibility control and recreate split DATA/control correctness.
      getCoopRuntime()?.durability?.reconnect();
      return;
    }
    coopLog("me", "await host terminal (leave / battle-handoff sentinel)", {
      seqTerm: this.seqTerm,
      timeoutMs: COOP_ME_REPLAY_WAIT_MS,
    });
    void relay
      .awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS, COOP_ME_TERMINAL_CHOICE_KINDS)
      .then(action => {
        this.handleTerminalAction(action);
      });
  }

  /** Clear any delayed re-await when an exact terminal lands or the ME/session ends. */
  public disposeRecoveryTimer(): void {
    if (this.terminalRecoveryTimer != null) {
      clearTimeout(this.terminalRecoveryTimer);
      this.terminalRecoveryTimer = null;
    }
  }

  /**
   * A null 9M result is timeout/cancellation, never an authoritative terminal. Reconnect the durability
   * tail and re-await the same exact address with a bounded backoff while the session/generation/pin remain
   * identical. This deliberately holds the phase instead of locally leaving and splitting counters.
   */
  private recoverMissingControl(reason: string, retry: () => void): void {
    const runtime = getCoopRuntime();
    const controller = getCoopController();
    const generation = coopSessionGeneration();
    if (runtime == null || controller == null || coopMeInteractionStartValue() !== this.interactionCounter) {
      coopWarn("me", `missing terminal (${reason}); session recovery owns the hold`, {
        counter: this.interactionCounter,
      });
      return;
    }
    try {
      runtime.durability?.reconnect();
    } catch {
      /* the retained raw waiter + hot-rejoin snapshot are independent recovery paths */
    }
    this.disposeRecoveryTimer();
    const delayMs = Math.min(250 * 2 ** Math.min(this.terminalRecoveryAttempt++, 3), 2_000);
    coopWarn("me", `missing terminal (${reason}); re-awaiting exact 9M control after ${delayMs}ms`, {
      counter: this.interactionCounter,
      seqTerm: this.seqTerm,
    });
    try {
      globalScene.ui.showText("Restoring your partner's event state...", null, undefined, 2500);
    } catch {
      /* cosmetic */
    }
    this.terminalRecoveryTimer = setTimeout(() => {
      this.terminalRecoveryTimer = null;
      if (
        activeCoopReplayMePhase !== this
        || getCoopRuntime() !== runtime
        || getCoopController() !== controller
        || coopSessionGeneration() !== generation
        || coopMeInteractionStartValue() !== this.interactionCounter
      ) {
        return;
      }
      retry();
    }, delayMs);
  }

  /**
   * Execute one complete retained terminal after the runtime has atomically adopted its authoritative
   * state. This is the P33 correctness path: no raw 9M choice, local ME reward engine, inferred battle
   * mode, or separately timed enemy-party carrier participates in the decision.
   */
  public canApplyCommittedTerminalTransaction(transaction: CoopMeCommittedTerminalTransaction): boolean {
    if (
      !this.boundaryStillLive()
      || transaction.pinned !== this.interactionCounter
      || (transaction.payload.terminal === "battle") !== (transaction.payload.destination.kind === "battle")
    ) {
      return false;
    }
    if (transaction.payload.terminal === "battle") {
      if (this.acceptedTerminal.kind === "pending") {
        return transaction.step === 0;
      }
      return (
        this.acceptedTerminal.kind === "battle-handoff"
        && ((this.acceptedTerminal.operationId === transaction.operationId
          && this.acceptedTerminal.step === transaction.step)
          || transaction.step === this.acceptedTerminal.step + 1)
      );
    }
    return (
      (this.acceptedTerminal.kind === "pending" && transaction.step === 0)
      || (this.acceptedTerminal.kind === "battle-handoff" && transaction.step === this.acceptedTerminal.step + 1)
      || (this.acceptedTerminal.kind === "leave"
        && this.acceptedTerminal.operationId === transaction.operationId
        && this.acceptedTerminal.step === transaction.step)
    );
  }

  public applyCommittedTerminalTransaction(transaction: CoopMeCommittedTerminalTransaction): boolean {
    if (!this.canApplyCommittedTerminalTransaction(transaction)) {
      return false;
    }
    const { operationId, payload, step } = transaction;
    if (this.acceptedTerminal.kind === "leave") {
      return this.acceptedTerminal.operationId === operationId && this.acceptedTerminal.step === step;
    }
    settleCoopMeOwnerIntentRetries();
    setCoopWaveTailSanction(coopMeTerminalSanctionedTails(payload));
    this.disposeRecoveryTimer();
    this.terminalRecoveryAttempt = 0;
    try {
      if (payload.destination.kind === "battle") {
        const expectedStep = this.acceptedTerminal.kind === "battle-handoff" ? this.acceptedTerminal.step + 1 : 0;
        if (step !== expectedStep) {
          return (
            this.acceptedTerminal.kind === "battle-handoff"
            && this.acceptedTerminal.operationId === operationId
            && this.acceptedTerminal.step === step
          );
        }
        this.finishWithoutLeaving(payload.destination.hostTurn, payload.destination);
        this.retryableBattleTerminalOperationId = null;
        this.acceptedTerminal = {
          kind: "battle-handoff",
          operationId,
          step,
          revision: captureCoopActiveMysteryControl()?.revision ?? 0,
        };
        return true;
      }
      const expectedStep = this.acceptedTerminal.kind === "battle-handoff" ? this.acceptedTerminal.step + 1 : 0;
      if (step !== expectedStep) {
        return false;
      }
      return this.completeCommittedLeave(operationId, step, payload.destination);
    } catch (error) {
      coopWarn("me", "complete retained Mystery terminal could not execute", {
        operationId,
        step,
        error,
      });
      failCoopSharedSession(`Mystery terminal ${operationId} could not execute coherently`);
      return false;
    }
  }

  /** Project the host's final state directly into its declared continuation, skipping local ME mechanics. */
  private completeCommittedLeave(operationId: string, step: number, destination: CoopMeContinueDestination): boolean {
    const controller = getCoopController();
    const battle = globalScene.currentBattle;
    if (
      controller == null
      || battle == null
      || destination.nextWave !== battle.waveIndex + 1
      || coopMeInteractionStartValue() !== this.interactionCounter
    ) {
      return false;
    }
    const currentPhase = globalScene.phaseManager.getCurrentPhase();
    hideCoopControllerTag();
    getCoopUiMirror()?.endSession();
    if (!coopMeHandoffBattleStarted()) {
      abortActiveCoopReplayTurnPhase("committed non-battle ME terminal");
    }
    // The authoritative outcome already contains every reward/material/save/RNG effect. Clear every
    // guest-derived tail and project only the host-declared continuation.
    globalScene.phaseManager.clearPhaseQueue();
    if (destination.selectBiome) {
      globalScene.phaseManager.pushNew("SelectBiomePhase");
    }
    globalScene.phaseManager.pushNew("NewBattlePhase");
    controller.advanceInteraction(this.interactionCounter);
    this.acceptedTerminal = {
      kind: "leave",
      operationId,
      step,
      revision: captureCoopActiveMysteryControl()?.revision ?? 0,
    };
    this.detachedBattleEndCompleted = true;
    this.settled = true;
    this.settledDetached = false;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    try {
      const relay = getCoopInteractionRelay();
      if (relay?.onRewardOptionsBuffered != null) {
        relay.onRewardOptionsBuffered = null;
      }
    } catch {
      /* teardown is best-effort */
    }
    setCoopMeBattleInteractionCounter(-1);
    setCoopMeInteractionStart(-1);
    // The replay may have handed control to a quiz/shop/battle phase. End whichever exact local surface
    // is still current so the already-queued host continuation becomes visible immediately.
    currentPhase.end();
    return true;
  }

  /** Apply a checksum-verified host terminal without re-inferring it from local field/phase state. */
  private applyVerifiedSnapshotTerminal(snapshot: CoopActiveMysteryEncounterSnapshotV1): void {
    if (
      !this.boundaryStillLive()
      || snapshot.terminal === "pending"
      || snapshot.terminalOperationId == null
      || snapshot.terminalStep == null
    ) {
      return;
    }
    if (isCoopMeOperationJournalActive()) {
      // Recovery control proves which retained operation is missing, but it does not contain the complete
      // authoritative DATA/destination transaction. Request that exact tail; never execute from diagnostics.
      coopWarn("me", "verified Mystery terminal control rebound; awaiting complete retained transaction", {
        counter: snapshot.interactionCounter,
        operationId: snapshot.terminalOperationId,
      });
      getCoopRuntime()?.durability?.reconnect();
      return;
    }
    this.disposeRecoveryTimer();
    this.terminalRecoveryAttempt = 0;
    if (snapshot.terminal === "battle") {
      if (this.acceptedTerminal.kind === "leave") {
        return;
      }
      if (
        this.acceptedTerminal.kind === "battle-handoff"
        && this.acceptedTerminal.operationId === snapshot.terminalOperationId
      ) {
        if (this.settled) {
          return;
        }
        try {
          this.finishWithoutLeaving(snapshot.hostTurn);
          this.retryableBattleTerminalOperationId = null;
        } catch {
          this.settled = false;
          this.acceptedTerminal = { kind: "pending" };
          this.retryableBattleTerminalOperationId = snapshot.terminalOperationId;
        }
        return;
      }
      if (!this.settled) {
        try {
          this.finishWithoutLeaving(snapshot.hostTurn);
        } catch {
          this.settled = false;
          this.acceptedTerminal = { kind: "pending" };
          this.retryableBattleTerminalOperationId = snapshot.terminalOperationId;
          return;
        }
      }
      this.retryableBattleTerminalOperationId = null;
      this.acceptedTerminal = {
        kind: "battle-handoff",
        operationId: snapshot.terminalOperationId,
        step: snapshot.terminalStep,
        revision: snapshot.revision,
      };
      return;
    }
    if (this.acceptedTerminal.kind === "leave") {
      return;
    }
    const followedBattle = this.acceptedTerminal.kind === "battle-handoff";
    if ((!followedBattle && snapshot.terminalStep !== 0) || (followedBattle && snapshot.terminalStep !== 1)) {
      return;
    }
    const applied = followedBattle ? this.completeDetachedBattleEnd() : this.leaveDefensive();
    if (!applied) {
      return;
    }
    this.acceptedTerminal = {
      kind: "leave",
      operationId: snapshot.terminalOperationId,
      step: snapshot.terminalStep,
      revision: snapshot.revision,
    };
  }

  /**
   * Rebind the retained replay after a checksum-verified hot-rejoin snapshot. Pending state restores only
   * the exact host presentation; terminal state may finish the encounter. No snapshot/null local inference.
   */
  public rebindFromActiveMysterySnapshot(snapshot: CoopActiveMysteryEncounterSnapshotV1): void {
    if (snapshot.interactionCounter !== this.interactionCounter || !this.boundaryStillLive()) {
      return;
    }
    // The host snapshot is authority. If our local step ran ahead, that proposal was not committed and its
    // selector must be allowed to retry the exact ordinal after the channel replacement.
    const rebound = resolveCoopMeOwnerIntentRebind(snapshot, this.pickStep);
    this.pickStep = rebound.pickStep;
    this.subPickStep = rebound.subPickStep;
    if (rebound.retryUncommittedPick) {
      this.pickSent = false;
    }
    coopMeSnapshotRebindDelegate?.(snapshot);
    if (snapshot.presentation != null) {
      const enc = globalScene.currentBattle?.mysteryEncounter;
      if (enc != null) {
        enc.dialogueTokens = {
          ...enc.dialogueTokens,
          ...snapshot.presentation.tokens,
        };
      }
      coopMeHostPresentation = snapshot.presentation;
    }
    if (snapshot.terminal !== "pending") {
      this.applyVerifiedSnapshotTerminal(snapshot);
      return;
    }
    this.disposeRecoveryTimer();
    this.terminalRecoveryAttempt = 0;
    if (this.settled || snapshot.presentation == null) {
      return;
    }
    const presentationKey = JSON.stringify(snapshot.presentation);
    if (presentationKey === this.lastSnapshotPresentationKey) {
      return;
    }
    this.lastSnapshotPresentationKey = presentationKey;
    // Only reopen a top-level selector when the atomic host phase says that selector is still current.
    // A retained sub-picker/quiz owns its own live UI; replaying an old sub-prompt could submit twice.
    if (snapshot.presentation.subPrompt == null) {
      const ownsMe = this.canLocalPlayerSelect();
      showCoopControllerTagFor(ownsMe);
      void this.openModeBounded(UiMode.MYSTERY_ENCOUNTER, undefined);
      if (!this.initialPresentationEntered) {
        this.initialPresentationEntered = true;
      }
      if (!ownsMe && !this.raceArmed) {
        const relay = getCoopInteractionRelay();
        if (relay != null) {
          this.awaitOutcomeThenTerminal(relay);
        }
      }
    }
  }

  /**
   * Resolve the host's ME terminal action (#633). Shared by {@linkcode awaitHostTerminal} (the
   * sequential post-resync await) and the {@linkcode awaitOutcomeThenTerminal} race (when the host
   * reached its terminal on 9M with NO trailing meResync). Runs the terminal exactly once via the
   * `settled` guard inside finishWithoutLeaving / leaveDefensive.
   */
  private handleTerminalAction(action: CoopInteractionChoice | null): void {
    if (!this.boundaryStillLive()) {
      return;
    }
    if (action == null) {
      // Timeout, stale-wait supersession, and watchdog cancellation are transport facts, not a host leave.
      // Keep the event pinned and request the durable tail; only a real 9M/journal/snapshot terminal exits.
      this.liveTerminalArm = undefined;
      this.recoverMissingControl("null terminal carrier", () => {
        const relay = getCoopInteractionRelay();
        if (relay != null) {
          this.awaitHostTerminal(relay);
        }
      });
      return;
    }
    if (
      action.choice === COOP_ME_BATTLE_HANDOFF
      && action.operationId != null
      && action.operationId === this.retryableBattleTerminalOperationId
    ) {
      try {
        this.finishWithoutLeaving(action.data?.[0]);
        this.retryableBattleTerminalOperationId = null;
        this.acceptedTerminal = {
          kind: "battle-handoff",
          operationId: action.operationId,
          step: 0,
          revision: captureCoopActiveMysteryControl()?.revision ?? 0,
        };
      } catch {
        this.settled = false;
      }
      return;
    }
    this.disposeRecoveryTimer();
    this.terminalRecoveryAttempt = 0;
    // Wave-2c (#859/#860 phantom class): gate the terminal through the authoritative operation primitive.
    // The host STATES the ME's resolution (leave vs battle) on the committed ME_TERMINAL op, so the watcher
    // routes its terminal off the OPERATION, never by inferring "there is a battle turn" from a leftover
    // battle chain. DUAL-RUN: the legacy 9M sentinel still carries the resolution and is the fallback; the
    // op's stated terminal (derived from the SAME sentinel) is preferred when adopted, so routing is
    // byte-identical while the decision is now operation-derived. A stale battle-handoff from an EARLIER ME
    // is REJECTED by the gate (adopt:false), so it can never build the phantom battle chain (#859).
    const legacyIsBattle = action != null && action.choice === COOP_ME_BATTLE_HANDOFF;
    const terminalDecision = adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: this.seqTerm,
      pinned: this.interactionCounter,
      res:
        action == null
          ? null
          : {
              choice: action.choice,
              data: action.data,
              operationId: action.operationId,
            },
      terminal: legacyIsBattle ? "battle" : "leave",
      hostTurn: action?.data?.[0],
      localRole: getCoopController()?.role ?? "guest",
      wave: globalScene.currentBattle?.waveIndex ?? -1,
      turn: 0,
    });
    if (!terminalDecision.adopt) {
      // A raw terminal that outran its committed envelope, a stale prior-ME terminal, or a duplicate is
      // never a license to mutate from the legacy choice. Re-await only the exact address; the journal
      // live sink supplies the tagged authoritative terminal when its commit is applied.
      coopWarn("me", `terminal not authoritative (${terminalDecision.reason}); holding exact 9M boundary`, {
        seqTerm: this.seqTerm,
        counter: this.interactionCounter,
      });
      const relay = getCoopInteractionRelay();
      if (relay != null && terminalDecision.reason !== "stale-or-duplicate") {
        this.awaitHostTerminal(relay);
      }
      return;
    }
    // The authoritative terminal causally closes every proposal from this encounter. Retire any retry whose
    // individual commit receipt was lost before it can leak stale picks into the next ME.
    settleCoopMeOwnerIntentRetries();
    const isBattleTerminal = terminalDecision.terminal === "battle";
    const operationId = action.operationId ?? "legacy-terminal";
    if (this.acceptedTerminal.kind === "leave") {
      return;
    }
    if (terminalDecision.terminal != null) {
      setCoopWaveTailSanction(coopMeTerminalSanctionedTails(terminalDecision.terminal));
    }
    coopLog("me", "host terminal resolved", {
      seqTerm: this.seqTerm,
      action: action == null ? "null" : action.choice,
      isHandoff: isBattleTerminal,
      viaOperation: terminalDecision.terminal != null,
    });
    try {
      // The host spawned a battle from this ME (#633 ME battle handoff): do NOT leave the
      // encounter. End here so the existing host-authoritative ME-battle path runs (the guest
      // already adopts the host's boss + replays the spawned battle via the battle relay).
      if (isBattleTerminal) {
        coopLog("me", "battle-handoff terminal (operation-stated); finishing without leaving", {
          seqTerm: this.seqTerm,
          hostTurn: action?.data?.[0],
        });
        this.finishWithoutLeaving(action?.data?.[0]);
        this.retryableBattleTerminalOperationId = null;
        this.acceptedTerminal = {
          kind: "battle-handoff",
          operationId,
          step: 0,
          revision: captureCoopActiveMysteryControl()?.revision ?? 0,
        };
        return;
      }
    } catch {
      this.settled = false;
      if (isBattleTerminal && action.operationId != null) {
        this.retryableBattleTerminalOperationId = action.operationId;
      }
      coopWarn("me", "battle terminal apply failed; holding for verified recovery", { seqTerm: this.seqTerm });
      this.recoverMissingControl("battle terminal apply failure", () => {
        const relay = getCoopInteractionRelay();
        if (relay != null) {
          this.awaitHostTerminal(relay);
        }
      });
      return;
    }
    // Only a real leave sentinel (or the operation-derived equivalent) can leave + advance. A null was
    // handled above as recovery and can never reach this mutation boundary.
    if (!this.leaveDefensive()) {
      return;
    }
    this.acceptedTerminal = {
      kind: "leave",
      operationId,
      step: 0,
      revision: captureCoopActiveMysteryControl()?.revision ?? 0,
    };
  }

  /** Exact, once-only TRUE leave after a previously accepted battle-handoff terminal. */
  private completeDetachedBattleEnd(controllerRef = getCoopController()): boolean {
    if (this.detachedBattleEndCompleted) {
      return true;
    }
    try {
      if (controllerRef == null) {
        throw new Error("shared controller unavailable");
      }
      if (coopMeInteractionStartValue() === this.interactionCounter) {
        coopLog("me", "detached ME end after battle handoff: exact leave accepted", {
          counter: this.interactionCounter,
        });
        leaveEncounterWithoutBattle();
      }
      controllerRef.advanceInteraction(this.interactionCounter);
    } catch (error) {
      coopWarn("me", "detached handoff end could not apply atomically; stopping shared session", error);
      failCoopSharedSession(`Detached Mystery battle terminal could not apply for ${this.interactionCounter}`);
      return false;
    }
    this.detachedBattleEndCompleted = true;
    this.disposeRecoveryTimer();
    return true;
  }

  /** Post-handoff 9M receiver: null/foreign values recover; only the exact leave completes the ME. */
  private handleDetachedBattleTerminal(
    action: CoopInteractionChoice | null,
    retry: () => void,
    controllerRef = getCoopController(),
  ): void {
    if (!this.boundaryStillLive()) {
      return;
    }
    if (action == null) {
      this.recoverMissingControl("null post-battle ME terminal", retry);
      return;
    }
    if (action.choice !== COOP_INTERACTION_LEAVE) {
      this.recoverMissingControl(`unexpected post-battle terminal ${action.choice}`, retry);
      return;
    }
    const terminalDecision = adoptMeWatcherChoice({
      kind: "ME_TERMINAL",
      seq: this.seqTerm,
      pinned: this.interactionCounter,
      step: 1,
      res: {
        choice: action.choice,
        data: action.data,
        operationId: action.operationId,
      },
      terminal: "leave",
      localRole: getCoopController()?.role ?? "guest",
      wave: globalScene.currentBattle?.waveIndex ?? -1,
      turn: 0,
    });
    if (!terminalDecision.adopt || this.acceptedTerminal.kind !== "battle-handoff") {
      const reason = terminalDecision.adopt ? "prior-terminal-state" : terminalDecision.reason;
      this.recoverMissingControl(`uncommitted/foreign post-battle terminal (${reason})`, retry);
      return;
    }
    if (!this.completeDetachedBattleEnd(controllerRef)) {
      return;
    }
    this.acceptedTerminal = {
      kind: "leave",
      operationId: action.operationId ?? "legacy-terminal",
      step: 1,
      revision: captureCoopActiveMysteryControl()?.revision ?? 0,
    };
  }

  /**
   * Battle-handoff terminal (#633): the host's option spawned a battle. End WITHOUT leaving the
   * encounter so the existing host-authoritative ME-battle path takes over (the guest already adopts
   * the host's boss via the battle relay). The single ME alternation advance happens at the TRUE ME
   * terminal after the spawned battle, so we must NOT advance here.
   */
  private finishWithoutLeaving(hostTurn?: number, committedDestination?: CoopMeBattleDestination): void {
    if (this.settled) {
      if (committedDestination != null && (this.settledDetached || this.acceptedTerminal.kind === "battle-handoff")) {
        // A quiz/nested-picker can finish its presentation phase before its option spawns a battle, and a
        // Colosseum CONTINUE produces another complete battle transaction after the prior round. In both
        // cases the retained step supersedes the detached surface and is the next mechanical boundary.
        this.settled = false;
        this.settledDetached = false;
      } else {
        coopLog("me", "finishWithoutLeaving no-op (already settled)", {
          counter: this.interactionCounter,
        });
        return;
      }
    }
    const currentPhase = globalScene.phaseManager.getCurrentPhase();
    // #822 TURN-SPACE ALIGNMENT: the host numbers its ME-battle turns CONTINUING the wave's
    // count; a guest booting at its own (stale) turn awaits resolutions keyed to numbers the
    // host never emits (the 18:05 strand). Adopt the host's turn before the battle boot.
    if (hostTurn !== undefined && globalScene.currentBattle != null) {
      coopLog("me", "guest ME battle boot: turn aligned to host (#822)", {
        guestTurn: globalScene.currentBattle.turn,
        hostTurn,
      });
      globalScene.currentBattle.turn = hostTurn;
    }
    // #822 DETACHED ME-END: the TRUE leave terminal arrives on the SAME 9M seq after the
    // spawned battle + rewards finish on the host. Arm it now so the guest ALWAYS leaves +
    // advances even if its battle replay stalled; guarded on the pin so a healthy guest that
    // already left naturally only re-runs the idempotent advance.
    {
      const counter = this.interactionCounter;
      const relayRef = getCoopInteractionRelay();
      // Bind the controller that owns this replay when the listener is armed. Besides making two-engine
      // harnesses faithful, this prevents a late terminal from ever advancing a replacement session whose
      // globals became active while the network promise was pending.
      const controllerRef = getCoopController();
      // #829 co-op COLOSSEUM: before arming the default detached 9M-await, offer the terminal to a
      // registered between-rounds delegate (the Colosseum gauntlet loop, from coop-colosseum.ts). If it
      // CLAIMS the terminal (returns true) it drives every SUBSEQUENT round + the eventual leave/advance
      // itself, so the default arm here would double-drive it - SKIP it. The delegate self-gates on its
      // own ME type, so a null delegate / a false return (solo + every non-colosseum ME) leaves the arm
      // below byte-identical (the existing #822 detached-terminal behaviour).
      const delegateOwnsTerminal =
        coopMeBattleEndDelegate != null
        && relayRef != null
        && coopMeBattleEndDelegate({
          interactionCounter: counter,
          seqTerm: this.seqTerm,
          relay: relayRef,
        });
      if (!delegateOwnsTerminal && !isCoopMeOperationJournalActive()) {
        const awaitTrueLeave = (): void => {
          void relayRef
            ?.awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS, COOP_ME_TERMINAL_CHOICE_KINDS)
            .then(action => {
              this.handleDetachedBattleTerminal(action, awaitTrueLeave, controllerRef);
            });
        };
        awaitTrueLeave();
      }
    }
    coopLog("me", "ME terminal: battle-handoff, ending phase WITHOUT leaving encounter", {
      counter: this.interactionCounter,
    });
    // #817: ME gates stand down - the battle runs the normal sync. #847: record the wave so the guest's
    // ME-battle-won victory-tail check is scoped to THIS battle (a stale flag can't misfire on a later one).
    setCoopMeHandoffBattleStarted(globalScene.currentBattle?.waveIndex ?? -1);
    hideCoopControllerTag();
    // #854: force-close any lingering reward/ME cursor mirror before the spawned battle runs - a mirror
    // an abandoned pre-battle embedded shop left open would otherwise overlay the ME battle's command UI.
    getCoopUiMirror()?.endSession();
    // P33: a committed battle transaction already applied the host's full party/field/double state and
    // carries the exact mode + constructor argument. The split stream/inference path remains rollback-only.
    if (committedDestination == null) {
      // #819 (live BOTH-stuck at the ME battle): the guest's field is EMPTY here - its own
      // wave roll's summon chain was purged at the divert (#813) and the host's ME-battle
      // summons run in a phase only the host executes. Adopt the host's streamed battle party
      // (buffered by now - it is sent just before the terminal) and queue the guest's OWN
      // MysteryEncounterBattlePhase so both sides summon: with a fielded party the guest's
      // CommandPhase opens its real fight UI and answers the host's command request.
      try {
        const key = meBattleHandoffKey(globalScene.currentBattle.waveIndex, this.interactionCounter);
        const enemies =
          getCoopBattleStreamer()?.consumeMeBattleEnemyParty?.(key)
          ?? getCoopBattleStreamer()?.consumeEnemyParty(globalScene.currentBattle.waveIndex);
        if (enemies != null && enemies.length > 0) {
          adoptCoopEnemiesStructural(enemies);
        }
        // #820: encounterMode is a HOST-engine write (initBattleWithEnemyConfig) - stale on the
        // guest, so MysteryEncounterBattlePhase matches NO branch and hangs (17:17 capture:
        // phase started, zero summons, 50s silence). Derive it from the adopted party: any
        // multi-bar mon -> BOSS_BATTLE, else WILD_BATTLE (they differ only in bgm).
        const meRef = globalScene.currentBattle.mysteryEncounter;
        if (meRef != null && meRef.encounterMode !== MysteryEncounterMode.TRAINER_BATTLE) {
          const anyBoss = globalScene.getEnemyParty().some(e => e.isBoss());
          meRef.encounterMode = anyBoss ? MysteryEncounterMode.BOSS_BATTLE : MysteryEncounterMode.WILD_BATTLE;
          coopLog("me", `guest ME battle boot: encounterMode -> ${anyBoss ? "BOSS" : "WILD"}_BATTLE (#820)`);
        }
        globalScene.phaseManager.unshiftNew("MysteryEncounterBattlePhase", false);
        coopLog("me", "guest queued its OWN ME battle boot (adopt + MysteryEncounterBattlePhase) (#819)", {
          adopted: enemies?.length ?? 0,
        });
      } catch (e) {
        coopWarn("me", "guest ME battle boot failed (falling through to the old flow)", e);
      }
    } else {
      const battle = globalScene.currentBattle;
      const encounter = battle?.mysteryEncounter;
      if (battle == null || encounter == null) {
        throw new Error("committed Mystery battle has no live encounter");
      }
      battle.turn = committedDestination.hostTurn;
      encounter.encounterMode = committedDestination.encounterMode as MysteryEncounterMode;
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.phaseManager.pushNew("MysteryEncounterBattlePhase", committedDestination.disableSwitch);
      coopLog("me", "guest queued committed ME battle destination", {
        mode: committedDestination.encounterMode,
        disableSwitch: committedDestination.disableSwitch,
        enemies: globalScene.getEnemyParty().length,
      });
    }
    this.settled = true;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    try {
      getCoopInteractionRelay()?.onRewardOptionsBuffered != null
        && (getCoopInteractionRelay()!.onRewardOptionsBuffered = null); // #821 listener teardown
    } catch {
      /* teardown is best-effort */
    }
    if (committedDestination == null) {
      this.end();
    } else {
      currentPhase.end();
    }
  }

  /**
   * #821 SHOP HANDOFF: the HOST engine opened (streamed the options for) the ME's embedded reward shop.
   * Settle this phase (WITHOUT leaving the encounter, WITHOUT advancing - the ME is still live) and run
   * the guest's OWN SelectModifierPhase. #828: that phase resolves its role from the ME OWNER, NOT a
   * forced watcher - on a HOST-owned ME the guest WATCHES (consumes the host's streamed options + mirrors
   * the host's picks); on a GUEST-owned ME the guest is the reward pick OWNER (adopts the host's streamed
   * options, DRIVES the interactive pick, and relays it for the host to apply). Either way a DETACHED
   * listener on the terminal seq performs the eventual leave + advance (the duties leaveDefensive runs).
   */
  private settleForWatcherShop(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    if (this.settled) {
      return;
    }
    coopLog(
      "me",
      "SHOP HANDOFF: host opened the embedded ME reward shop - running guest shop as ME-owner role (#821/#828)",
      {
        counter: this.interactionCounter,
        ownsMe: getCoopController()?.isLocalOwnerAtCounter(this.interactionCounter) ?? false,
      },
    );
    hideCoopControllerTag();
    relay.onRewardOptionsBuffered = null;
    // The phase's ALREADY-ARMED outcome/terminal race keeps running detached (promises
    // outlive end()): a later meResync still applies through the normal race handler, and
    // the eventual ME-end terminal runs leaveDefensive's duties via the settledDetached
    // branch below. If the handoff fired BEFORE the race was armed (fast-owner path), arm it
    // now so those channels are never orphaned.
    // #818: settledDetached generalizes the former settledForShop (a quiz handoff sets it too);
    // shopHandedOff marks the shop opened so the quiz-then-shop hook path never double-opens it.
    this.settledDetached = true;
    this.shopHandedOff = true;
    openGuestMeEmbeddedShop(this.interactionCounter); // #832: BiomeShopPhase for trader/market MEs, SelectModifierPhase otherwise
    this.settled = true;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    this.end();
  }

  /**
   * #818 QUIZ HANDOFF: the owner's engine opened the ME's embedded QUIZ minigame (the Guessing
   * Booth / Scrambled Pokedex / Snowy footprint hunt / Unown cipher / braille seal / Salvage Yard).
   * Like the reward shop (#821), the quiz runs on the OWNER's engine only, so its streamed sub-prompt
   * had no watcher-side handler and the guest sat parked in the ME await while the owner played a whole
   * multi-question sub-phase. Settle this phase DETACHED (WITHOUT leaving / advancing - the ME is still
   * live) and run the guest's OWN mirror ErQuizPhase, which self-relays its answers (drive publishes;
   * follow awaits the remote pick + self-feeds). The re-armed outcome/terminal race applies the post-quiz
   * meResync and runs the leave + advance duties at the true terminal, exactly like the shop handoff.
   * The rewardOptions hook stays LIVE: a reward shop can FOLLOW the quiz (Dormant Guardian's relic
   * screen after the braille trial), and the hook opens that watcher shop directly once settledDetached.
   */
  private settleForWatcherQuiz(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    sub: CoopMeQuizSubPrompt,
    terminalArm: MeTerminalArm,
  ): void {
    if (this.settled) {
      coopLog("me", "quiz handoff no-op (already settled)", {
        counter: this.interactionCounter,
      });
      return;
    }
    coopLog("me", "QUIZ HANDOFF: owner opened the embedded ME quiz - running mirror ErQuizPhase (#818)", {
      counter: this.interactionCounter,
      questions: sub.questions.length,
      stopOnWrong: sub.stopOnWrong,
    });
    hideCoopControllerTag();
    // #818: settledDetached (the generalized settledForShop) drives the shop-aware race guards + the
    // leaveDefensive leave/advance duty. Do NOT null relay.onRewardOptionsBuffered here: a reward shop
    // can FOLLOW the quiz (the relic screen after Dormant Guardian's braille trial), and the hook opens
    // that watcher shop directly once this phase is settledDetached (once-only via shopHandedOff).
    this.settledDetached = true;
    // Queue the guest's mirror quiz. It renders the SAME questions the host streamed and handles its OWN
    // answer relay internally (drive publishes each pick; follow awaits the remote pick + self-feeds it),
    // so we only construct + queue it and take NO engine action here - the authoritative quiz outcome
    // rides the host's comprehensive meResync at the ME terminal. Structural cast: the wire questions are
    // ErQuizQuestion-shaped (frozen contract).
    globalScene.phaseManager.unshiftNew("ErQuizPhase", {
      questions: sub.questions as ErQuizQuestion[],
      stopOnWrong: sub.stopOnWrong,
      onComplete: (result: ErQuizResult) =>
        this.boundaryStillLive()
          ? coopLog("me", "guest mirror quiz complete (engine outcome comes from the host)", {
              correct: result.correct,
              answered: result.answered,
            })
          : undefined,
    });
    // The outcome/terminal race that DELIVERED this quiz subPrompt has already resolved (its raceDone is
    // set). Re-arm the race DETACHED (promises outlive end()) so the host's post-quiz meResync applies
    // through the normal race handler and the eventual ME-end terminal runs leaveDefensive's leave +
    // advance duties via the settledDetached branch. CRITICAL (#818 latent race): the re-arm INHERITS the
    // delivering race's terminalArm instead of re-awaiting 9M - if a fast host already buffered its LEAVE
    // before the guest reached this handoff, the original arm consumed it (buffer-hit) and a fresh await
    // on the emptied inbox would park forever: state would converge but the guest would never leave or
    // advance (a permanent counter desync - the probe agent's live-timing finding).
    this.awaitOutcomeThenTerminal(relay, terminalArm);
    this.settled = true;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    this.end();
  }

  /**
   * Defensive ME end: leave the encounter locally (the host already resolved it) and advance the
   * single alternation turn idempotently, mirroring the watcher's onLeave terminal in
   * mystery-encounter-phases. Runs EXACTLY once (guarded by `settled`). Never throws; never hangs.
   *
   * The ME PIN is NOT cleared here: the host layer clears it in the guest's PostMysteryEncounterPhase
   * guard (after the embedded watcher shop), so the pin lives across this leave -> embedded shop drain.
   */
  private leaveDefensive(): boolean {
    if (this.settled) {
      if (this.settledDetached) {
        // #821/#818: settled by a DETACHED handoff (watcher SHOP or mirror QUIZ) - the phase ended
        // but the encounter is only now over (the ME-end terminal just fired). Run the leave duties
        // detachedly, ONCE (the flag flip guarantees the once-only for a detached-settled phase).
        coopLog("me", "detached ME terminal after watcher shop/quiz: leaving + advancing (#821/#818)", {
          counter: this.interactionCounter,
        });
        // #854: force-close any lingering reward/ME cursor mirror. When the embedded watcher shop was
        // ABANDONED (its watch crashed on a stale pick, or leaveEncounterWithoutBattle cleared its phase
        // before it reached coopEndMirror), the reward uiMirror stayed OPEN and overlaid the continuing
        // game ("the ME screen never dismisses"). endSession is idempotent - a no-op if already closed.
        getCoopUiMirror()?.endSession();
        // #859 (Delibird-gift wave desync): on a NON-battle ME the watcher-shop LEAVE can fall
        // through into the ME wave's leftover battle chain (TurnInit -> Command -> TurnStart ->
        // CoopReplayTurnPhase) BEFORE this terminal fires - a phantom turn parked awaiting a
        // battle the host never fights (the host is already in the NEXT wave).
        // leaveEncounterWithoutBattle clears only the QUEUE, so dissolve the RUNNING phantom
        // first. A real battle handoff never takes this detached branch, but guard anyway - its
        // replay turn is genuine.
        if (!coopMeHandoffBattleStarted()) {
          abortActiveCoopReplayTurnPhase("detached non-battle ME terminal (#859)");
        }
        const controller = getCoopController();
        try {
          if (controller == null) {
            throw new Error("shared controller unavailable");
          }
          leaveEncounterWithoutBattle();
          controller.advanceInteraction(this.interactionCounter);
        } catch (error) {
          coopWarn("me", "detached Mystery leave could not apply; stopping shared session", error);
          failCoopSharedSession(`Detached Mystery leave could not apply for ${this.interactionCounter}`);
          return false;
        }
        this.settledDetached = false;
        return true;
      }
      coopLog("me", "leaveDefensive no-op (already settled)", {
        counter: this.interactionCounter,
      });
      return true;
    }
    coopLog("me", "ME terminal: leaving encounter locally + advancing alternation", {
      counter: this.interactionCounter,
    });
    hideCoopControllerTag();
    // #854: force-close any lingering reward/ME cursor mirror at the ME terminal (see the detached
    // branch above) - a mirror the abandoned embedded shop never closed must not overlay the next wave.
    getCoopUiMirror()?.endSession();
    const controller = getCoopController();
    try {
      if (controller == null) {
        throw new Error("shared controller unavailable");
      }
      // leaveEncounterWithoutBattle clears the phase queue + queues the post-ME wave-advance phases
      // (the same terminal the watcher onLeave uses in mystery-encounter-phases), so the guest reaches
      // the next wave instead of looping the ME.
      leaveEncounterWithoutBattle();
      // The single ME alternation advance: idempotent (keyed to this ME's start counter), so it
      // no-ops if the host's terminal / a reconcile broadcast already advanced.
      controller.advanceInteraction(this.interactionCounter);
    } catch (error) {
      coopWarn("me", "Mystery leave could not apply; stopping shared session", error);
      failCoopSharedSession(`Mystery leave could not apply for ${this.interactionCounter}`);
      return false;
    }
    this.settled = true;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    try {
      getCoopInteractionRelay()?.onRewardOptionsBuffered != null
        && (getCoopInteractionRelay()!.onRewardOptionsBuffered = null); // #821 listener teardown
    } catch {
      /* teardown is best-effort */
    }
    this.end();
    return true;
  }
}

// The runtime's durability sink owns validation/DATA apply and calls this leaf-routed projection only
// when the exact retained replay boundary is live. Returning false withholds the ACK for late rebind.
setOnMeCommittedTerminal(
  transaction => activeCoopReplayMePhase?.applyCommittedTerminalTransaction(transaction) === true,
  transaction => activeCoopReplayMePhase?.canApplyCommittedTerminalTransaction(transaction) === true,
);

// Registered once at module load. Runtime snapshot adoption calls the leaf pin-state seam, which rebounds
// the retained phase without introducing a runtime <-> phase import cycle.
setOnMeSnapshotRebind(snapshot => {
  if (activeCoopReplayMePhase == null) {
    if (coopMeInteractionStartValue() === snapshot.interactionCounter) {
      coopWarn("me", "verified Mystery snapshot arrived without a retained replay phase; holding for queue recovery", {
        counter: snapshot.interactionCounter,
        terminal: snapshot.terminal,
      });
    }
    return;
  }
  activeCoopReplayMePhase.rebindFromActiveMysterySnapshot(snapshot);
});

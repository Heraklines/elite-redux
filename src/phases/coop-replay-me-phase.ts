/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { applyCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { adoptCoopEnemiesStructural } from "#data/elite-redux/coop/coop-enemy-builder";
import type { CoopInteractionChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { coopMeInteractionStartValue, setCoopMeHandoffBattleStarted } from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_BATTLE_HANDOFF, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import { getCoopBattleStreamer, getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import type { ErQuizQuestion } from "#data/elite-redux/er-quiz";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { ErQuizResult } from "#phases/er-quiz-phase";
import { hideCoopControllerTag, showCoopControllerTagFor } from "#ui/coop-controller-tag";
import type { OptionSelectConfig } from "#ui/handlers/abstract-option-select-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

/** Same seq base the ME pump uses (coop-me-pump consumers key off `BASE + interactionCounter`). */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
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
 * EVERY await has a defensive timeout (the host-stall analog of CoopReplayTurnPhase.finishTurnNoStream):
 * a null resolution leaves the encounter locally and ends so the run never hangs; the next per-ME /
 * per-turn checksum re-syncs any residual numeric drift. A single `settled` terminal guarantees the
 * defensive leave runs EXACTLY once (so the outcome await + the leave-sentinel await never double-leave).
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

  constructor(interactionCounter: number) {
    super();
    this.interactionCounter = interactionCounter;
    this.seq = COOP_ME_PUMP_SEQ_BASE + interactionCounter;
    this.seqTerm = COOP_ME_TERM_SEQ_BASE + interactionCounter;
  }

  public override start(): void {
    super.start();
    coopLog("me", "guest diverted into CoopReplayMePhase", {
      counter: this.interactionCounter,
      seqMe: this.seq,
      seqTerm: this.seqTerm,
      wave: globalScene.currentBattle?.waveIndex,
    });
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      // No live session (defensive): leave the encounter locally so the run never hangs.
      coopWarn("me", "no interaction relay at ME start; defensive leave", { counter: this.interactionCounter });
      this.leaveDefensive();
      return;
    }
    // Render the host's authoritative ME narration as it arrives (cosmetic; the outcome rides the
    // reward alternation + the comprehensive P4 resync, so a dropped line can never desync). Dropped
    // at the terminal in leaveDefensive / finishWithoutLeaving.
    this.offMeMessage =
      getCoopBattleStreamer()?.onMeMessage(text => {
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
    relay.onRewardOptionsBuffered = key => {
      if (!String(key).startsWith(shopKeyPrefix)) {
        return;
      }
      if (globalScene !== registeringScene) {
        coopLog("me", "shop-handoff notification under a foreign scene (harness ctx); deferring", { key });
        return;
      }
      // #818: a reward shop can FOLLOW a quiz handoff (Dormant Guardian's relic screen after
      // the braille trial). Once the QUIZ already settled this phase DETACHED, settleForWatcherShop's
      // `settled` guard would no-op, so open the guest shop DIRECTLY here - exactly once
      // (shopHandedOff). #828: the SelectModifierPhase resolves its role from the ME OWNER (watcher on
      // a host-owned ME, pick owner on a guest-owned one). The detached race the quiz re-armed still
      // runs the ME-end leave/advance.
      if (this.settledDetached) {
        if (!this.shopHandedOff) {
          this.shopHandedOff = true;
          coopLog(
            "me",
            "reward shop FOLLOWS the quiz handoff - opening guest ME-owner-role shop directly (#818/#828)",
            {
              counter: this.interactionCounter,
            },
          );
          globalScene.phaseManager.unshiftNew("SelectModifierPhase");
        }
        return;
      }
      this.settleForWatcherShop(relay);
    };
    // The post-subscription work is async (it awaits the host's presentation), but the phase
    // contract is sync-void: wrap it in a void-ed IIFE, mirroring CoopReplayTurnPhase's `.then`
    // pattern. Every await inside has a defensive null-end, so the IIFE can never hang the run.
    void (async () => {
      // P0 (#633 BLOCK-2): await the host's authoritative presentation BEFORE rendering/awaiting so
      // the option selector renders off the host's `meetsReqs` / `labels` (the guest's own onInit /
      // meetsRequirements read its DIVERGED party). A null (host stall) falls through: the handler
      // re-derives locally (degraded but never a hang).
      coopLog("me", "await host presentation (mePresent)", { seq: this.seq, timeoutMs: COOP_ME_REPLAY_WAIT_MS });
      const present = await relay.awaitInteractionOutcome(this.seq, COOP_ME_REPLAY_WAIT_MS);
      if (present != null && present.k === "mePresent") {
        const enc = globalScene.currentBattle.mysteryEncounter;
        if (enc != null) {
          enc.dialogueTokens = { ...enc.dialogueTokens, ...present.tokens }; // host tokens win (itemName etc.)
          coopMeHostPresentation = present; // the UI handler reads meetsReqs / labels from this
          coopLog("me", "adopted host presentation", {
            seq: this.seq,
            opts: present.meetsReqs.length,
            labels: present.labels.length,
            tokens: Object.keys(present.tokens).length,
          });
        }
      } else {
        coopWarn("me", "presentation await resolved without mePresent (host stall); local re-derivation", {
          seq: this.seq,
          got: present == null ? "null" : present.k,
        });
      }

      // #821: the SHOP HANDOFF settled this phase while we awaited the presentation. The
      // race was deliberately NOT armed inside the handoff (it would have consumed the
      // buffered mePresent as an outcome); arm it here, detached - the detached-settle guards
      // let the later meResync apply and the ME-end terminal run the leave duties. (Only the
      // shop reaches here: a quiz always settles from INSIDE the race, so raceArmed is already
      // true by then - it re-arms its own detached race in settleForWatcherQuiz.)
      if (this.settled && this.settledDetached && !this.raceArmed) {
        this.awaitOutcomeThenTerminal(relay);
        return;
      }
      if (this.settled) {
        return; // settled some other way mid-await (defensive)
      }

      // Ownership is resolved from the PINNED start counter (stable for the whole ME), never the live
      // counter. When the GUEST OWNS this ME, render the REAL option selector locally off the host
      // presentation and return: the UI handler forwards the human's pick to handleGuestOptionSelect,
      // which relays it + drives the sub-pick loop + the terminal. When the HOST owns it, the guest is
      // a pure renderer: await the comprehensive outcome (P4) then the leave terminal.
      const ownsMe = getCoopController()?.isLocalOwnerAtCounter(this.interactionCounter) ?? false;
      coopLog("me", "ME ownership resolved", {
        counter: this.interactionCounter,
        ownsMe,
        branch: ownsMe ? "guest renders selector + relays picks" : "pure renderer (await outcome+terminal)",
      });
      if (ownsMe) {
        // Same setMode call MysteryEncounterPhase.start uses; the handler renders off the streamed
        // presentation (getCoopMeHostPresentation) and captures the human's cursor.
        showCoopControllerTagFor(true); // #817: the shop-style top banner, green = you drive
        void globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, undefined);
        return;
      }
      // #817 visibility: the watcher sees the SAME screen as the owner - the real option
      // selector (input is blocked for non-owners by the ui.ts gate; the owner's cursor is
      // mirrored via meCursor) - plus the shop-style named tag saying who is driving.
      showCoopControllerTagFor(false);
      void globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, undefined);
      this.awaitOutcomeThenTerminal(relay);
    })();
  }

  /**
   * GUEST-OWNED ME top-level pick (#633 BLOCK-3): relay the chosen option INDEX to the host (the sole
   * engine), then drive the sub-pick loop + await the host's authoritative outcome + leave terminal.
   * View-party (cursor === viewPartyIndex) is handled locally in the UI handler and never reaches here.
   */
  /** #815: one top-level pick per ME - a double-fired select must not re-arm the awaits. */
  private pickSent = false;

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

  /**
   * #831 (audit P0#1, GROUP REPEAT): how many REPEATED option-select rounds (each a bare re-fired mePresent
   * with NO subPrompt) this phase re-rendered AFTER the initial presentation. 0 for a single-round ME; N for
   * an (N+1)-round press-your-luck delve / Safari loop. A duo-harness test seam (read via the established
   * `as unknown as {...}` cast, like `settled`).
   */
  private newRoundsRendered = 0;

  public handleGuestOptionSelect(index: number): void {
    if (this.pickSent) {
      coopWarn("me", "DUPLICATE guest option select IGNORED (#815 re-entry guard)", {
        counter: this.interactionCounter,
        index,
      });
      return;
    }
    this.pickSent = true;
    // #819 ('the selection screen doesn't disappear'): the pick is committed - dismiss the
    // option UI so narration renders in a clean message box, mirroring the engine side.
    void globalScene.ui.setMode(UiMode.MESSAGE);
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      coopWarn("me", "no relay on guest option select; defensive leave", { counter: this.interactionCounter, index });
      this.leaveDefensive();
      return;
    }
    coopLog("me", "guest relays top-level ME pick", { seq: this.seq, kind: ME_CHOICE_KIND, index });
    relay.sendInteractionChoice(this.seq, ME_CHOICE_KIND, index); // P1 on seq_me
    // #831: for a REPEATED option-select round (delve / Safari) beginNewRound reset pickSent so THIS pick is
    // allowed, and this re-armed race INHERITS the live 9M terminal arm (awaitOutcomeThenTerminal reads
    // this.liveTerminalArm) rather than re-awaiting the inbox - a fast host's buffered LEAVE is never lost.
    this.awaitOutcomeThenTerminal(relay);
  }

  /**
   * GUEST-OWNED ME sub-pick (#633 BLOCK-3): a party-target slot or a secondary-option index. Relayed on
   * the SAME seq_me (CHOICE inbox, FIFO); the host consumes one per sub-prompt site (ADD-2b).
   */
  public relayGuestSubPick(value: number): void {
    coopLog("me", "guest relays ME sub-pick", { seq: this.seq, kind: ME_SUBPICK_KIND, value });
    getCoopInteractionRelay()?.sendInteractionChoice(this.seq, ME_SUBPICK_KIND, value); // P1b on seq_me (FIFO)
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
   *  - 9M terminal wins (LEAVE / battle-handoff / null host stall) -> resolve the terminal directly,
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
      ?? relay.awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS).then(action => ({
        tag: "terminal" as const,
        action,
      }));
    this.liveTerminalArm = terminalArm;
    void Promise.race([outcomeArm, terminalArm]).then(winner => {
      if (raceDone) {
        return;
      }
      raceDone = true;
      if (this.settled && !this.settledDetached) {
        coopLog("me", "outcome/terminal race resolved after settled; ignoring", { seq: this.seq });
        return;
      }
      // The HOST reached its ME terminal on 9M (LEAVE / battle-handoff) WITHOUT a trailing meResync,
      // or the host stalled (null): resolve the terminal directly. This is the softlock fix - we no
      // longer block on an 8M outcome the host never sends for these terminals.
      if (winner.tag === "terminal") {
        coopLog("me", "terminal won the outcome/terminal race (no trailing meResync)", {
          seqTerm: this.seqTerm,
          action: winner.action == null ? "null" : winner.action.choice,
        });
        this.handleTerminalAction(winner.action);
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
        this.openSubPickCapture(relay, outcome.subPrompt);
        return;
      }
      if (outcome != null && outcome.k === "meResync") {
        coopLog("me", "host sent comprehensive outcome (meResync); applying", { seq: this.seq });
        try {
          applyCoopMeOutcome(outcome); // CHANGE-4 apply: party / save / RNG / dex converge with the host
        } catch {
          coopWarn("me", "meResync apply threw; per-turn checksum will re-sync", { seq: this.seq });
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
      void globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, undefined);
      return;
    }
    // Watcher: adopt the presentation for display (the real selector, input-blocked for non-owners) + re-arm
    // the outcome/terminal race INHERITING the live terminalArm, and keep waiting for the next round / terminal.
    showCoopControllerTagFor(false); // #817: amber = partner drives this round
    void globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, undefined);
    this.awaitOutcomeThenTerminal(relay, terminalArm);
  }

  /**
   * ADD-1c: open the LOCAL capture screen matching the host's streamed sub-prompt (the guest takes NO
   * engine action - it only captures the human's slot/index and relays it). After relaying, loop back to
   * {@linkcode awaitOutcomeThenTerminal} for the next sub-prompt or the terminal resync.
   */
  private openSubPickCapture(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    subPrompt: { kind: "party" } | { kind: "secondary"; labels: string[] },
  ): void {
    const restoreMode = globalScene.ui.getMode();
    if (subPrompt.kind === "party") {
      coopLog("me", "opening local PARTY sub-pick capture", { seq: this.seq, restoreMode });
      // Party target: open the same PARTY/SELECT screen the host's selectPokemonForOption opens, capture
      // the chosen slot, relay it, and loop. The callback takes no engine action (the host's engine
      // resolves the target authoritatively from the relayed slot).
      void globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.SELECT, -1, (slotIndex: number) => {
        coopLog("me", "captured party sub-pick slot", { seq: this.seq, slotIndex });
        void globalScene.ui.setMode(restoreMode).then(() => {
          this.relayGuestSubPick(slotIndex);
          this.awaitOutcomeThenTerminal(relay);
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
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      const options = labels.map((label, idx) => ({
        label,
        handler: () => {
          this.captureSecondaryPick(relay, restoreMode, idx);
          return true;
        },
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          // Out-of-range index => the host runs the option's not-selected / default branch.
          this.captureSecondaryPick(relay, restoreMode, labels.length);
          return true;
        },
      });
      const config: OptionSelectConfig = { options, maxOptions: 7, yOffset: 0 };
      void globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
    });
  }

  /** ADD-1c secondary-menu helper: restore the prior mode, relay the chosen index, loop. */
  private captureSecondaryPick(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    restoreMode: UiMode,
    index: number,
  ): void {
    coopLog("me", "captured secondary sub-pick index", { seq: this.seq, index });
    globalScene.ui.clearText();
    void globalScene.ui.setMode(restoreMode).then(() => {
      this.relayGuestSubPick(index);
      this.awaitOutcomeThenTerminal(relay);
    });
  }

  /**
   * Await the host's authoritative ME terminal on the interaction relay (the LEAVE sentinel) or the
   * battle-handoff sentinel, on the DEDICATED terminal seq (`9_000_000 + counter`, disjoint from the
   * pick/outcome seq). A null (host stall / partner gone) defensively leaves the encounter.
   */
  private awaitHostTerminal(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    coopLog("me", "await host terminal (leave / battle-handoff sentinel)", {
      seqTerm: this.seqTerm,
      timeoutMs: COOP_ME_REPLAY_WAIT_MS,
    });
    void relay.awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS).then(action => {
      this.handleTerminalAction(action);
    });
  }

  /**
   * Resolve the host's ME terminal action (#633). Shared by {@linkcode awaitHostTerminal} (the
   * sequential post-resync await) and the {@linkcode awaitOutcomeThenTerminal} race (when the host
   * reached its terminal on 9M with NO trailing meResync). Runs the terminal exactly once via the
   * `settled` guard inside finishWithoutLeaving / leaveDefensive.
   */
  private handleTerminalAction(action: CoopInteractionChoice | null): void {
    coopLog("me", "host terminal resolved", {
      seqTerm: this.seqTerm,
      action: action == null ? "null" : action.choice,
      isHandoff: action?.choice === COOP_ME_BATTLE_HANDOFF,
    });
    try {
      // The host spawned a battle from this ME (#633 ME battle handoff): do NOT leave the
      // encounter. End here so the existing host-authoritative ME-battle path runs (the guest
      // already adopts the host's boss + replays the spawned battle via the battle relay).
      if (action != null && action.choice === COOP_ME_BATTLE_HANDOFF) {
        coopLog("me", "battle-handoff sentinel on seq_term; finishing without leaving", {
          seqTerm: this.seqTerm,
          hostTurn: action.data?.[0],
        });
        this.finishWithoutLeaving(action.data?.[0]);
        return;
      }
    } catch {
      coopWarn("me", "bad terminal payload; falling through to defensive leave", { seqTerm: this.seqTerm });
    }
    // A leave sentinel (host reached the ME terminal) OR a null (host stall / partner gone) both
    // mean "the encounter is over on the host": leave it locally + advance the alternation turn,
    // then end. The host already applied the rewards/side effects through the streams; the next
    // checksum re-syncs any residual numeric drift, so this never desyncs and never hangs.
    this.leaveDefensive();
  }

  /**
   * Battle-handoff terminal (#633): the host's option spawned a battle. End WITHOUT leaving the
   * encounter so the existing host-authoritative ME-battle path takes over (the guest already adopts
   * the host's boss via the battle relay). The single ME alternation advance happens at the TRUE ME
   * terminal after the spawned battle, so we must NOT advance here.
   */
  private finishWithoutLeaving(hostTurn?: number): void {
    if (this.settled) {
      coopLog("me", "finishWithoutLeaving no-op (already settled)", { counter: this.interactionCounter });
      return;
    }
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
      void relayRef?.awaitInteractionChoice(this.seqTerm, COOP_ME_REPLAY_WAIT_MS).then(() => {
        if (coopMeInteractionStartValue() === counter) {
          coopLog("me", "detached ME end after battle handoff: leaving + advancing (#822)", { counter });
          try {
            leaveEncounterWithoutBattle();
          } catch {
            coopWarn("me", "leaveEncounterWithoutBattle threw at detached handoff end (handled)", { counter });
          }
        }
        try {
          getCoopController()?.advanceInteraction(counter);
        } catch {
          coopWarn("me", "advanceInteraction threw at detached handoff end (handled, idempotent)", { counter });
        }
      });
    }
    coopLog("me", "ME terminal: battle-handoff, ending phase WITHOUT leaving encounter", {
      counter: this.interactionCounter,
    });
    setCoopMeHandoffBattleStarted(); // #817: ME gates stand down - the battle runs the normal sync
    hideCoopControllerTag();
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
    globalScene.phaseManager.unshiftNew("SelectModifierPhase");
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
      coopLog("me", "quiz handoff no-op (already settled)", { counter: this.interactionCounter });
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
        coopLog("me", "guest mirror quiz complete (engine outcome comes from the host)", {
          correct: result.correct,
          answered: result.answered,
        }),
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
  private leaveDefensive(): void {
    if (this.settled) {
      if (this.settledDetached) {
        // #821/#818: settled by a DETACHED handoff (watcher SHOP or mirror QUIZ) - the phase ended
        // but the encounter is only now over (the ME-end terminal just fired). Run the leave duties
        // detachedly, ONCE (the flag flip guarantees the once-only for a detached-settled phase).
        this.settledDetached = false;
        coopLog("me", "detached ME terminal after watcher shop/quiz: leaving + advancing (#821/#818)", {
          counter: this.interactionCounter,
        });
        try {
          leaveEncounterWithoutBattle();
        } catch {
          coopWarn("me", "leaveEncounterWithoutBattle threw at detached ME terminal (handled)", {
            counter: this.interactionCounter,
          });
        }
        try {
          getCoopController()?.advanceInteraction(this.interactionCounter);
        } catch {
          coopWarn("me", "advanceInteraction threw at detached ME terminal (handled, idempotent)", {
            counter: this.interactionCounter,
          });
        }
        return;
      }
      coopLog("me", "leaveDefensive no-op (already settled)", { counter: this.interactionCounter });
      return;
    }
    coopLog("me", "ME terminal: leaving encounter locally + advancing alternation", {
      counter: this.interactionCounter,
    });
    hideCoopControllerTag();
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
    const controller = getCoopController();
    try {
      // leaveEncounterWithoutBattle clears the phase queue + queues the post-ME wave-advance phases
      // (the same terminal the watcher onLeave uses in mystery-encounter-phases), so the guest reaches
      // the next wave instead of looping the ME.
      leaveEncounterWithoutBattle();
    } catch {
      // the encounter teardown is best-effort; a failure must never hang the run
      coopWarn("me", "leaveEncounterWithoutBattle threw at ME terminal (handled)", {
        counter: this.interactionCounter,
      });
    }
    // The single ME alternation advance: idempotent (keyed to this ME's start counter), so it
    // no-ops if the host's terminal / a reconcile broadcast already advanced.
    try {
      controller?.advanceInteraction(this.interactionCounter);
    } catch {
      // advance is idempotent + best-effort
      coopWarn("me", "advanceInteraction threw at ME terminal (handled, idempotent)", {
        counter: this.interactionCounter,
      });
    }
    this.end();
  }
}

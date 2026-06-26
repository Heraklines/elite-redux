/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { applyCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_ME_BATTLE_HANDOFF, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import { getCoopBattleStreamer, getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
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
          globalScene.phaseManager.queueMessage(text);
        } catch {
          /* a narration render failure must never hang the guest's encounter */
        }
      }) ?? null;

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
        void globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, undefined);
        return;
      }
      this.awaitOutcomeThenTerminal(relay);
    })();
  }

  /**
   * GUEST-OWNED ME top-level pick (#633 BLOCK-3): relay the chosen option INDEX to the host (the sole
   * engine), then drive the sub-pick loop + await the host's authoritative outcome + leave terminal.
   * View-party (cursor === viewPartyIndex) is handled locally in the UI handler and never reaches here.
   */
  public handleGuestOptionSelect(index: number): void {
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      coopWarn("me", "no relay on guest option select; defensive leave", { counter: this.interactionCounter, index });
      this.leaveDefensive();
      return;
    }
    coopLog("me", "guest relays top-level ME pick", { seq: this.seq, kind: ME_CHOICE_KIND, index });
    relay.sendInteractionChoice(this.seq, ME_CHOICE_KIND, index); // P1 on seq_me
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
   * terminal), the guest applies it and proceeds to the leave terminal. A null (host stall) falls through
   * to the leave terminal; the single `settled` guard fires the leave exactly once.
   */
  private awaitOutcomeThenTerminal(relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    coopLog("me", "await host outcome (mePresent subPrompt / meResync)", {
      seq: this.seq,
      timeoutMs: COOP_ME_REPLAY_WAIT_MS,
    });
    void relay.awaitInteractionOutcome(this.seq, COOP_ME_REPLAY_WAIT_MS).then(outcome => {
      if (this.settled) {
        coopLog("me", "outcome resolved after settled; ignoring", { seq: this.seq });
        return;
      }
      if (outcome != null && outcome.k === "mePresent" && outcome.subPrompt != null) {
        // ADD-1c: the host opened an engine sub-prompt. Open the matching local capture screen, relay
        // the human's pick, and loop for the next sub-prompt / the terminal resync.
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
      } else {
        coopWarn("me", "outcome await resolved to terminal without meResync (host stall)", {
          seq: this.seq,
          got: outcome == null ? "null" : outcome.k,
        });
      }
      // A null (host stall) OR the comprehensive resync both mean "proceed to the terminal".
      this.awaitHostTerminal(relay);
    });
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
          });
          this.finishWithoutLeaving();
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
    });
  }

  /**
   * Battle-handoff terminal (#633): the host's option spawned a battle. End WITHOUT leaving the
   * encounter so the existing host-authoritative ME-battle path takes over (the guest already adopts
   * the host's boss via the battle relay). The single ME alternation advance happens at the TRUE ME
   * terminal after the spawned battle, so we must NOT advance here.
   */
  private finishWithoutLeaving(): void {
    if (this.settled) {
      coopLog("me", "finishWithoutLeaving no-op (already settled)", { counter: this.interactionCounter });
      return;
    }
    coopLog("me", "ME terminal: battle-handoff, ending phase WITHOUT leaving encounter", {
      counter: this.interactionCounter,
    });
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
      coopLog("me", "leaveDefensive no-op (already settled)", { counter: this.interactionCounter });
      return;
    }
    coopLog("me", "ME terminal: leaving encounter locally + advancing alternation", {
      counter: this.interactionCounter,
    });
    this.settled = true;
    coopMeHostPresentation = null;
    this.offMeMessage?.();
    this.offMeMessage = null;
    const controller = getCoopController();
    try {
      // leaveEncounterWithoutBattle clears the phase queue + queues the post-ME wave-advance phases
      // (the same terminal the watcher onLeave uses in mystery-encounter-phases), so the guest reaches
      // the next wave instead of looping the ME.
      leaveEncounterWithoutBattle();
    } catch {
      // the encounter teardown is best-effort; a failure must never hang the run
      coopWarn("me", "leaveEncounterWithoutBattle threw at ME terminal (handled)", { counter: this.interactionCounter });
    }
    // The single ME alternation advance: idempotent (keyed to this ME's start counter), so it
    // no-ops if the host's terminal / a reconcile broadcast already advanced.
    try {
      controller?.advanceInteraction(this.interactionCounter);
    } catch {
      // advance is idempotent + best-effort
      coopWarn("me", "advanceInteraction threw at ME terminal (handled, idempotent)", { counter: this.interactionCounter });
    }
    this.end();
  }
}

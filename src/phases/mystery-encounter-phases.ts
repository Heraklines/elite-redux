import { consumeClearMeOverrideAfterFirst } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { captureCoopChecksum, captureCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_INTERACTION_LEAVE } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  coopMeHandoffBattleStarted,
  coopMeInProgress,
  coopMeInteractionStartValue,
  setCoopMeInteractionStart,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import {
  getCoopBattleStreamer,
  getCoopController,
  getCoopInteractionRelay,
  getCoopMePump,
  getCoopNetcodeMode,
  getCoopRuntime,
  isCoopAuthoritativeGuest,
  setCoopMeBattleInteractionCounter,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { IvScannerModifier } from "#modifiers/modifier";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { OptionSelectSettings } from "#mystery-encounters/encounter-phase-utils";
import {
  COOP_AUTHORITATIVE_BESPOKE_SUB_ME,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounterOption, OptionPhaseCallback } from "#mystery-encounters/mystery-encounter-option";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { hideCoopControllerTag, showCoopControllerTagFor } from "#ui/coop-controller-tag";
import { randSeedItem } from "#utils/common";
import { inSpeedOrder } from "#utils/speed-order-generator";
import i18next from "i18next";

// =============================================================================
// Co-op (#633): a whole mystery encounter is ONE alternating interaction. The OWNER
// drives every interactive screen and relays each button; the WATCHER replays them
// (via the CoopMePump) so both run the identical encounter and get identical rewards.
// The pump rides a dedicated seq range (distinct from the reward-shop seqs) keyed by
// the interaction counter, so owner + watcher agree on it and it is unique per ME.
// The embedded battle + the end-of-ME reward shop keep their own co-op owners (the
// battle command relay / the shop relay); the pump auto-suspends for them via the
// phase gate in ui.ts.
// =============================================================================
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
/** Co-op authoritative non-battle ME (#633): the DISCONNECT ceiling for every host<->guest await
 *  (mirrors `CoopReplayMePhase` / the interaction relay default). NOT a deliberation timer - steady
 *  state resolves on the relayed message; this only fires for a genuinely disconnected partner. */
const COOP_ME_REPLAY_WAIT_MS = 1_200_000;

// Co-op (#633): the alternation counter this ME opened on. Both clients advance the
// turn LOCALLY + idempotently at the ME terminal (keyed to this value), so the ME's
// single advance can never double-count regardless of whether the owner's terminal or
// the watcher's fast-forward fires first. -1 = not in an ME. The pin STATE lives in the
// cycle-free leaf module `coop-me-pin-state` (encounter-phase-utils + ui.ts read it there
// without importing this phase module, which itself imports encounter-phase-utils);
// re-exported here so existing consumers keep their import path.
export { coopMeInProgress, coopMeInteractionStartValue };

/**
 * Co-op authoritative GUEST (#633, CHANGE-3): pin the ME interaction counter at the guest's ME
 * ENTRY (independent of who owns it), so `coopMeInProgress()` is TRUE for the guest's WHOLE ME.
 * That keeps the embedded reward-shop counter-guard AND the reward-owner override firing across the
 * guest's full encounter (incl. the in-flight watcher shop). The host pins the same counter in
 * `coopBeginMePump`; the guest never reaches that path (it diverts to CoopReplayMePhase), so the pin
 * is set here instead. Cleared at the guest's true post-ME boundary (the PostMysteryEncounterPhase
 * guest guard), NOT at leaveDefensive (MAJOR-3).
 */
export function coopSetMePinForGuest(counter: number): void {
  coopLog("me", "coopSetMePinForGuest", { before: coopMeInteractionStartValue(), after: counter });
  setCoopMeInteractionStart(counter);
  setCoopMeBattleInteractionCounter(counter);
}

/** Co-op authoritative GUEST (#633, CHANGE-3): clear the guest's ME pin at the true post-ME
 *  boundary (after the embedded watcher reward shop has drained). */
export function coopClearMePinForGuest(): void {
  coopLog("me", "coopClearMePinForGuest", { before: coopMeInteractionStartValue(), after: -1 });
  setCoopMeInteractionStart(-1);
  hideCoopControllerTag(); // #817: never outlive the encounter
  setCoopMeBattleInteractionCounter(-1);
}

/**
 * Co-op (#633): open the ME input pump for this client. The OWNER (whose alternating turn it
 * is, or the host in the dev/spoof path) drives + relays; the WATCHER replays. Idempotent across
 * nested option-selects (same seq). Hard no-op in solo / outside a live co-op run.
 */
function coopBeginMePump(): void {
  if (!globalScene.gameMode.isCoop) {
    return;
  }
  const controller = getCoopController();
  const pump = getCoopMePump();
  if (controller == null || pump == null) {
    return;
  }
  // Capture the alternation counter at the ME's start (== seq - BASE). The ME terminal
  // advances the turn ONCE per client, idempotently keyed to this value (#633).
  const meStart = controller.interactionCounter();
  setCoopMeInteractionStart(meStart);
  // Pin the same counter for the ME BATTLE HANDOFF key (#633): if this ME's option spawns a
  // battle, the host streams the boss party keyed by (waveIndex, this counter) and the guest
  // adopts it, so the spawned boss is identical + host-authoritative on both clients. Reset at
  // the ME terminal (coopEndMePump).
  setCoopMeBattleInteractionCounter(meStart);
  const seq = COOP_ME_PUMP_SEQ_BASE + meStart;
  const spoofed = getCoopRuntime()?.spoof != null;
  // Co-op AUTHORITATIVE netcode (#633, ADD-2): the HOST is the SOLE ME engine for EVERY non-battle
  // ME - host- AND guest-owned alike (the guest's diverged RNG must never run encounter logic). So
  // in authoritative mode the HOST always drives the engine (beginOwner), even when the guest OWNS
  // the ME; it then awaits the guest's relayed option index and applies it programmatically (the
  // host-await block below in MysteryEncounterPhase.start). The guest already diverted to
  // CoopReplayMePhase at :202, so only the HOST ever reaches coopBeginMePump in authoritative mode.
  // In LOCKSTEP (either client) the owner/watcher split stands byte-identical (both run the engine).
  // Co-op is AUTHORITATIVE-ONLY (#633 M3/M6): the HOST is the SOLE ME engine for EVERY non-battle
  // ME (host- AND guest-owned alike); the guest already diverted to CoopReplayMePhase at :202 and
  // NEVER reaches here. So whoever reaches coopBeginMePump is the owner (the host, or the local
  // human in the dev/spoof path) and always drives the engine (beginOwner) + awaits the guest's
  // relayed option index (the host-await block in MysteryEncounterPhase.start). The old LOCKSTEP
  // watcher branch (both clients ran the engine; the non-owner replayed the owner's button stream
  // via CoopMePump.beginWatcher) is RETIRED - lockstep is gone, so that path was dead.
  const hostDrives = controller.role === "host";
  coopLog("me", "coopBeginMePump owner resolution (authoritative-only)", {
    counter: meStart,
    seq,
    role: controller.role,
    spoofed,
    hostDrives,
  });
  // Resolve the ME owner from the PINNED start counter (#633), not the live counter - an inbound
  // reconcile broadcast can bump the live counter mid-encounter, which would flip the owner/seq calc.
  // The host sends its TERMINAL sentinels (LEAVE / battle-handoff) on the DEDICATED 9M terminal seq,
  // where the guest's CoopReplayMePhase.awaitHostTerminal listens (disjoint from the 8M pick relay).
  const termSeq = COOP_ME_TERM_SEQ_BASE + meStart;
  // #817: the shop-style tag on the HOST too - green when this ME is the host's own to drive
  // (the amber awaiting-partner tag is shown at the guest-await site in MysteryEncounterPhase).
  if (controller.isLocalOwnerAtCounter(meStart)) {
    showCoopControllerTagFor(true);
  }
  pump.beginOwner(seq, termSeq);
  coopLog("me", "ME owner streamed entry checksum", { seq });
  // TRACK-2 Phase C: stamp the owner's authoritative full-state checksum at ME entry so the guest's
  // CoopReplayMePhase can verify its render state matches before applying the streamed outcome. The
  // guest's verify+heal handler is wired once in the runtime.
  getCoopBattleStreamer()?.sendMeChecksum(seq, captureCoopChecksum());
}

/**
 * Co-op (#633): close the ME input pump at the encounter terminal. The OWNER sends the leave
 * sentinel (the watcher fast-forwards to the next wave); the HOST advances the alternation turn
 * ONCE for the whole encounter (its embedded reward shop suppresses its own advance while an ME
 * is active, so this is the single advance).
 */
function coopEndMePump(): void {
  if (!globalScene.gameMode.isCoop) {
    return;
  }
  const controller = getCoopController();
  const pump = getCoopMePump();
  if (controller == null || pump == null) {
    return;
  }
  coopLog("me", "coopEndMePump: close pump + advance alternation", { counter: coopMeInteractionStartValue() });
  // #822 (live 'after the ME it doesn't continue for one player'): for a BATTLE-handoff ME the
  // pump session already ended at the battle spawn, so endOwner() below sends NO leave sentinel -
  // the guest never learns the encounter is over. Send the TRUE ME-end LEAVE explicitly; the
  // guest's detached post-handoff listener leaves + advances on it (idempotent if it already did).
  if (coopMeHandoffBattleStarted() && controller.role === "host") {
    const relay = getCoopInteractionRelay();
    const termSeq = COOP_ME_TERM_SEQ_BASE + coopMeInteractionStartValue();
    coopLog("me", "post-handoff ME END: sending TRUE leave terminal (#822)", { termSeq });
    relay?.sendInteractionChoice(termSeq, "meBtn", COOP_INTERACTION_LEAVE);
  }
  pump.endOwner();
  // Both clients advance LOCALLY + idempotently (keyed to the ME's start counter), so the
  // whole ME (encounter + its embedded reward shop, which suppresses its own advance) counts
  // as exactly ONE alternation step on each client - no host-broadcast race (#633).
  controller.advanceInteraction(coopMeInteractionStartValue());
  setCoopMeInteractionStart(-1);
  hideCoopControllerTag(); // #817: never outlive the encounter
  // Clear the ME battle handoff key now the encounter is fully over (#633).
  setCoopMeBattleInteractionCounter(-1);
}

/**
 * Will handle (in order):
 * - Clearing of phase queues to enter the Mystery Encounter game state
 * - Management of session data related to MEs
 * - Initialization of ME option select menu and UI
 * - Execute {@linkcode MysteryEncounter.onPreOptionPhase} logic if it exists for the selected option
 * - Display any `OptionTextDisplay.selected` type dialogue that is set in the {@linkcode MysteryEncounterDialogue} dialogue tree for selected option
 * - Queuing of the {@linkcode MysteryEncounterOptionSelectedPhase}
 */
export class MysteryEncounterPhase extends Phase {
  public readonly phaseName = "MysteryEncounterPhase";
  private readonly FIRST_DIALOGUE_PROMPT_DELAY = 300;
  optionSelectSettings?: OptionSelectSettings | undefined;

  /**
   * Mostly useful for having repeated queries during a single encounter, where the queries and options may differ each time
   * @param optionSelectSettings allows overriding the typical options of an encounter with new ones
   */
  constructor(optionSelectSettings?: OptionSelectSettings) {
    super();
    this.optionSelectSettings = optionSelectSettings;
  }

  /**
   * Updates seed offset, sets seen encounter session data, sets UI mode
   */
  start() {
    super.start();

    // Co-op AUTHORITATIVE netcode (#633, TRACK-2 Phase C): the guest's ME engine/RNG is diverged
    // from the host's, so the guest must NOT run the encounter engine. Divert to CoopReplayMePhase:
    // a pure renderer + choice-forwarder that awaits the host's authoritative ME outcome (narration
    // via the message stream, rewards via the reward alternation, side effects via the full-state
    // snapshot) and forwards the guest's choice when the guest OWNS this ME. Hard-gated to the live
    // authoritative GUEST, so solo / lockstep / host run the engine unchanged. A battle-spawning ME
    // is transparent: CoopReplayMePhase ends on the battle-handoff sentinel and the existing
    // host-authoritative ME-battle path takes over.
    if (isCoopAuthoritativeGuest()) {
      const interactionCounter = getCoopController()?.interactionCounter() ?? -1;
      coopLog("me", "authoritative guest: diverting MysteryEncounterPhase -> CoopReplayMePhase", {
        counter: interactionCounter,
        wave: globalScene.currentBattle?.waveIndex,
      });
      // CHANGE-3: pin the ME interaction counter for the guest's WHOLE ME (so coopMeInProgress() is
      // TRUE across the embedded watcher reward shop too). Cleared at the PostMysteryEncounterPhase
      // guest guard, AFTER the shop drains (MAJOR-3), never at leaveDefensive.
      coopSetMePinForGuest(interactionCounter);
      // #813 (live 'the other person threw out a pokemon'): the guest's LOCAL wave setup may
      // have rolled a normal battle before adopting the host's ME snapshot, leaving a stale
      // summon chain in the queue. This is an ME wave - nothing summons - so PURGE it, or the
      // watcher's screen throws a mon out over the encounter instead of rendering it.
      let purged = 0;
      for (const stale of [
        "SummonPhase",
        "PostSummonPhase",
        "ToggleDoublePositionPhase",
        "CheckSwitchPhase",
      ] as const) {
        while (globalScene.phaseManager.tryRemovePhase(stale)) {
          purged++;
        }
      }
      if (purged > 0) {
        coopLog("me", `purged ${purged} stale summon-chain phases at ME divert (#813)`);
      }
      globalScene.phaseManager.pushNew("CoopReplayMePhase", interactionCounter);
      this.end();
      return;
    }

    // Clears out queued phases that are part of standard battle
    globalScene.phaseManager.clearPhaseQueue();

    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.updateSeedOffset();

    if (!this.optionSelectSettings) {
      // Sets flag that ME was encountered, only if this is not a followup option select phase
      // Can be used in later MEs to check for requirements to spawn, run history, etc.
      globalScene.mysteryEncounterSaveData.encounteredEvents.push(
        new SeenEncounterData(encounter.encounterType, encounter.encounterTier, globalScene.currentBattle.waveIndex),
      );
      // Dev-tools: a scenario that FORCED this encounter clears its ME overrides
      // here so it fires once instead of re-spawning every wave. No-op in prod.
      consumeClearMeOverrideAfterFirst();
    }

    // Initiates encounter dialogue window and option select
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, this.optionSelectSettings);
    // Co-op (#633): open the input pump so the owner drives + relays this encounter and the
    // watcher replays it in lockstep (synced choices -> synced rewards). Idempotent across a
    // re-entered/nested option-select; no-op in solo.
    coopBeginMePump();
    // Co-op AUTHORITATIVE host (#633, P0 / BLOCK-2): stream the host's authoritative presentation
    // (dialogue tokens + per-option enablement + resolved labels) so the guest renders off it, not
    // its own diverged-party re-derivation. No-op off the live authoritative host.
    this.coopHostStreamPresentation();
    // Co-op AUTHORITATIVE host on a GUEST-OWNED ME (#633, ADD-2): the host is the sole engine, so it
    // awaits the guest's relayed option INDEX and applies it programmatically (input-free). No-op
    // when the host owns this ME (it drives the engine off its own local input) or off authoritative.
    this.coopHostAwaitGuestIndex();
  }

  /**
   * Co-op AUTHORITATIVE host (#633, P0 / BLOCK-2): the guest's `onInit` / `meetsRequirements` read
   * its DIVERGED party (bench order / held items / luck), so it would render different option labels
   * / enablement / dialogue tokens (itemName, selectedPokemon). Stream the host's authoritative
   * presentation so the guest renders off it. Hard-gated to the live authoritative host; solo /
   * lockstep / guest never emit, so those paths are byte-for-byte unchanged. Best-effort + guarded.
   */
  private coopHostStreamPresentation(): void {
    if (
      !globalScene.gameMode.isCoop
      || getCoopNetcodeMode() !== "authoritative"
      || getCoopController()?.role !== "host"
      || !coopMeInProgress()
    ) {
      return;
    }
    try {
      const enc = globalScene.currentBattle.mysteryEncounter!;
      // Ensure tokens + per-option meetsReqs are computed off the host party before snapshotting.
      enc.populateDialogueTokensFromRequirements();
      // #831 (audit P0#1, GROUP REPEAT): a re-fired ROUND (press-your-luck delve / Safari Zone) carries its
      // NEW options in optionSelectSettings.overrideOptions - the SAME set coopHostAwaitGuestIndex applies the
      // relayed index against, and the SAME set the host's own MysteryEncounterUiHandler renders. Stream THOSE
      // labels/enablement (not the stale base enc.options) so the guest re-renders the round's real "descend
      // again? / dig again?" prompt byte-identically. Falls back to enc.options for the top-level round.
      const options = this.optionSelectSettings?.overrideOptions ?? enc.options;
      const present: CoopInteractionOutcome = {
        k: "mePresent",
        tokens: { ...enc.dialogueTokens },
        meetsReqs: options.map(o => o.meetsRequirements()),
        labels: options.map(o => {
          const d = o.dialogue;
          if (d == null) {
            return "";
          }
          const ok = o.meetsRequirements();
          return getEncounterText(!ok && d.disabledButtonLabel ? d.disabledButtonLabel : d.buttonLabel) ?? "";
        }),
      };
      const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
      coopLog("me", "host streams ME presentation (mePresent)", {
        seq: seqMe,
        opts: present.meetsReqs.length,
        labels: present.labels.length,
        tokens: Object.keys(present.tokens).length,
      });
      getCoopInteractionRelay()?.sendInteractionOutcome(seqMe, "mePresent", present);
    } catch {
      coopWarn("me", "host presentation send threw; guest degrades to local re-derivation", {
        counter: coopMeInteractionStartValue(),
      });
    }
  }

  /**
   * Co-op AUTHORITATIVE host on a GUEST-OWNED ME (#633, ADD-2 / D1): the host runs the sole ME
   * engine but the GUEST makes the top-level pick, so the host awaits the guest's relayed option
   * INDEX and applies it programmatically via {@linkcode handleOptionSelect} (input-free). A null
   * resolution (a genuinely disconnected guest) safe-leaves the encounter + closes the pump so the
   * host never hangs; steady state resolves on the human pick. Hard-gated: no-op when the host owns
   * this ME, off authoritative, or in solo / lockstep.
   */
  private coopHostAwaitGuestIndex(): void {
    if (
      !globalScene.gameMode.isCoop
      || getCoopNetcodeMode() !== "authoritative"
      || getCoopController()?.role !== "host"
      || (getCoopController()?.isLocalOwnerAtCounter(coopMeInteractionStartValue()) ?? true)
    ) {
      return; // host owns this ME (drives off local input) / not the authoritative host
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return;
    }
    const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
    coopLog("me", "host awaits guest ME option index", { seq: seqMe, timeoutMs: COOP_ME_REPLAY_WAIT_MS });
    // #817 visibility: the shop's controller tag (top of screen, named, amber) while the
    // PARTNER decides - never drawn into the message box, so nothing layers over the options.
    showCoopControllerTagFor(false);
    void relay.awaitInteractionChoice(seqMe, COOP_ME_REPLAY_WAIT_MS).then(choice => {
      if (choice == null || choice.choice < 0) {
        // D1 null-end: a disconnected guest must never hang the host's engine - safe-leave + close.
        coopWarn("me", "host await guest index null/negative (disconnected guest); safe-leave", {
          seq: seqMe,
          choice: choice == null ? "null" : choice.choice,
        });
        leaveEncounterWithoutBattle();
        coopEndMePump();
        return;
      }
      coopLog("me", "host received guest ME option index", { seq: seqMe, index: choice.choice });
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const options = this.optionSelectSettings?.overrideOptions ?? encounter.options;
      const opt = options[choice.choice];
      if (opt == null) {
        coopWarn("me", "host: relayed index out of range; safe-leave", {
          seq: seqMe,
          index: choice.choice,
          optionCount: options.length,
        });
        leaveEncounterWithoutBattle();
        coopEndMePump();
        return;
      }
      // ADD-2c (BLOCK-3 residual): an ME whose option chain pushes a BESPOKE interactive sub-PHASE
      // (ErQuizPhase) has no generic party/secondary host relay site. It is NOT safe-degraded: #818 co-op
      // quiz MIRRORING - the 8 quiz MEs are MIRRORED, the host streams the question session and BOTH clients
      // run ErQuizPhase off it, with the GUEST owner driving its OWN answers over the quiz relay. So the host
      // input gate must STAY UP (standing it down would let the HOST player hijack and answer the guest's
      // quiz), and every case falls through unchanged to the programmatic option apply below
      // (ErQuizPhase.start streams the session there).
      // #827: CLOWNING_AROUND (a bespoke yes/no OPTION_SELECT) is no longer in this set - it now relays its
      // yes/no as a `{ kind: "secondary" }` sub-prompt (coopHostStreamSecondaryAwaitIndex) exactly like the
      // party->secondary path, so it needs no bespoke branch and reaches this apply like any relayed ME. The
      // #823 host-drives set is therefore EMPTY (setCoopMeBespokeHostDrives is never set true anymore; the
      // ui.ts gate reader stays as a harmless always-false guard, kept for a future bespoke host-drive ME).
      if (COOP_AUTHORITATIVE_BESPOKE_SUB_ME.has(encounter.encounterType)) {
        coopLog(
          "me",
          `quiz ME on guest-owned encounter ${MysteryEncounterType[encounter.encounterType]}: MIRRORED (host gate stays up; guest owner drives the quiz) (#818)`,
          { seq: seqMe, index: choice.choice },
        );
      }
      coopLog("me", "host applies relayed guest option programmatically", {
        seq: seqMe,
        index: choice.choice,
        encounter: MysteryEncounterType[encounter.encounterType],
      });
      hideCoopControllerTag(); // #817: the pick landed - the tag comes down before the engine runs it
      // Input-free option apply (the same path the local handler uses): drives onPre / onOption /
      // onPost; the engine sub-prompts (party target / secondary menu) await the guest's relayed
      // sub-picks at their own sites (encounter-phase-utils ADD-2b).
      this.handleOptionSelect(opt, choice.choice);
    });
  }

  /**
   * Triggers after a player selects an option for the encounter
   * @param option
   * @param index
   */
  handleOptionSelect(option: MysteryEncounterOption, index: number): boolean {
    // Set option selected flag
    globalScene.currentBattle.mysteryEncounter!.selectedOption = option;

    // #record-replay (single-player): capture the ME option pick (top-level "me" vs a followup "meSub").
    // No-op unless recording / in co-op (co-op drives the ME via its pump, which owns that path).
    recordSinglePlayerInteraction(this.optionSelectSettings ? "meSub" : "me", index);

    if (!this.optionSelectSettings) {
      // Saves the selected option in the ME save data, only if this is not a followup option select phase
      // Can be used for analytics purposes to track what options are popular on certain encounters
      const encounterSaveData = globalScene.mysteryEncounterSaveData.encounteredEvents.at(-1)!;
      if (encounterSaveData.type === globalScene.currentBattle.mysteryEncounter?.encounterType) {
        encounterSaveData.selectedOption = index;
      }
    }

    if (!option.onOptionPhase) {
      return false;
    }

    // Populate dialogue tokens for option requirements
    globalScene.currentBattle.mysteryEncounter!.populateDialogueTokensFromRequirements();

    if (option.onPreOptionPhase) {
      globalScene.executeWithSeedOffset(async () => {
        return await option.onPreOptionPhase!().then(result => {
          if (result == null || result) {
            this.continueEncounter();
          }
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset());
    } else {
      this.continueEncounter();
    }

    return true;
  }

  /**
   * Queues {@linkcode MysteryEncounterOptionSelectedPhase}, displays option.selected dialogue and ends phase
   */
  continueEncounter() {
    const endDialogueAndContinueEncounter = () => {
      globalScene.phaseManager.pushNew("MysteryEncounterOptionSelectedPhase");
      this.end();
    };

    const optionSelectDialogue = globalScene.currentBattle?.mysteryEncounter?.selectedOption?.dialogue;
    if (optionSelectDialogue?.selected && optionSelectDialogue.selected.length > 0) {
      // Handle intermediate dialogue (between player selection event and the onOptionSelect logic)
      globalScene.ui.setMode(UiMode.MESSAGE);
      const selectedDialogue = optionSelectDialogue.selected;
      let i = 0;
      const showNextDialogue = () => {
        const nextAction = i === selectedDialogue.length - 1 ? endDialogueAndContinueEncounter : showNextDialogue;
        const dialogue = selectedDialogue[i];
        let title: string | null = null;
        const text: string | null = getEncounterText(dialogue.text);
        if (dialogue.speaker) {
          title = getEncounterText(dialogue.speaker);
        }

        i++;
        if (title) {
          globalScene.ui.showDialogue(
            text ?? "",
            title,
            null,
            nextAction,
            0,
            i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0,
          );
        } else {
          globalScene.ui.showText(text ?? "", null, nextAction, i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
        }
      };

      showNextDialogue();
    } else {
      endDialogueAndContinueEncounter();
    }
  }

  /**
   * Ends phase
   */
  end() {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}

/**
 * Will handle (in order):
 * - Execute {@linkcode MysteryEncounter.onOptionSelect} logic if it exists for the selected option
 *
 * It is important to point out that no phases are directly queued by any logic within this phase
 * Any phase that is meant to follow this one MUST be queued via the onOptionSelect() logic of the selected option
 */
export class MysteryEncounterOptionSelectedPhase extends Phase {
  public readonly phaseName = "MysteryEncounterOptionSelectedPhase";
  onOptionSelect: OptionPhaseCallback;

  constructor() {
    super();
    this.onOptionSelect = globalScene.currentBattle.mysteryEncounter!.selectedOption!.onOptionPhase;
  }

  /**
   * Will handle (in order):
   * - Execute {@linkcode MysteryEncounter.onOptionSelect} logic if it exists for the selected option
   *
   * It is important to point out that no phases are directly queued by any logic within this phase.
   * Any phase that is meant to follow this one MUST be queued via the {@linkcode MysteryEncounter.onOptionSelect} logic of the selected option.
   */
  start() {
    super.start();
    // Co-op AUTHORITATIVE GUEST (#633): the guest runs no ME engine (its RNG is diverged). If a
    // nested/re-entered ME phase is ever queued on the guest, end it immediately - CoopReplayMePhase
    // is the guest's sole ME driver. Solo / lockstep / host unaffected.
    if (isCoopAuthoritativeGuest()) {
      coopLog("me", "authoritative guest: ending MysteryEncounterOptionSelectedPhase (no engine)", {
        counter: coopMeInteractionStartValue(),
      });
      this.end();
      return;
    }
    if (globalScene.currentBattle.mysteryEncounter?.autoHideIntroVisuals) {
      transitionMysteryEncounterIntroVisuals().then(() => {
        globalScene.executeWithSeedOffset(() => {
          this.onOptionSelect().finally(() => {
            this.end();
          });
        }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 500);
      });
    } else {
      globalScene.executeWithSeedOffset(() => {
        this.onOptionSelect().finally(() => {
          this.end();
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 500);
    }
  }
}

/**
 * Runs at the beginning of an Encounter's battle
 * Will clean up any residual flinches, Endure, etc. that are left over from {@linkcode MysteryEncounter.startOfBattleEffects}
 * Will also handle Game Overs, switches, etc. that could happen from {@linkcode handleMysteryEncounterBattleStartEffects}
 * See {@linkcode TurnEndPhase} for more details
 */
export class MysteryEncounterBattleStartCleanupPhase extends Phase {
  public readonly phaseName = "MysteryEncounterBattleStartCleanupPhase";
  /**
   * Cleans up `TURN_END` tags, any {@linkcode PostTurnStatusEffectPhase}s, checks for Pokemon switches, then continues
   */
  start() {
    super.start();

    // Lapse any residual flinches/endures but ignore all other turn-end battle tags
    const includedLapseTags = [BattlerTagType.FLINCHED, BattlerTagType.ENDURING];
    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      const tags = pokemon.summonData.tags;
      tags
        .filter(
          t =>
            includedLapseTags.includes(t.tagType)
            && t.lapseTypes.includes(BattlerTagLapseType.TURN_END)
            && !t.lapse(pokemon, BattlerTagLapseType.TURN_END),
        )
        .forEach(t => {
          t.onRemove(pokemon);
          tags.splice(tags.indexOf(t), 1);
        });
    }

    // Remove any status tick phases
    globalScene.phaseManager.removeAllPhasesOfType("PostTurnStatusEffectPhase");

    // The total number of Pokemon in the player's party that can legally fight
    const legalPlayerPokemon = globalScene.getPokemonAllowedInBattle();
    // The total number of legal player Pokemon that aren't currently on the field
    const legalPlayerPartyPokemon = legalPlayerPokemon.filter(p => !p.isActive(true));
    if (legalPlayerPokemon.length === 0) {
      globalScene.phaseManager.unshiftNew("GameOverPhase");
      return this.end();
    }

    // Check for any KOd player mons and switch
    // For each fainted mon on the field, if there is a legal replacement, summon it
    const playerField = globalScene.getPlayerField();
    playerField.forEach((pokemon, i) => {
      if (!pokemon.isAllowedInBattle() && legalPlayerPartyPokemon.length > i) {
        globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.SWITCH, i, true, false);
      }
    });

    // THEN, if is a double battle, and player only has 1 summoned pokemon, center pokemon on field
    if (globalScene.currentBattle.double && legalPlayerPokemon.length === 1 && legalPlayerPartyPokemon.length === 0) {
      globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
    }

    for (const pokemon of globalScene.getField(true)) {
      pokemon.resetTurnData();
    }

    this.end();
  }
}

/**
 * Will handle (in order):
 * - Setting BGM
 * - Showing intro dialogue for an enemy trainer or wild Pokemon
 * - Sliding in the visuals for enemy trainer or wild Pokemon, as well as handling summoning animations
 * - Queue the {@linkcode SummonPhase}s, {@linkcode PostSummonPhase}s, etc., required to initialize the phase queue for a battle
 */
export class MysteryEncounterBattlePhase extends Phase {
  public readonly phaseName = "MysteryEncounterBattlePhase";
  disableSwitch: boolean;

  constructor(disableSwitch = false) {
    super();
    this.disableSwitch = disableSwitch;
  }

  /**
   * Sets up a ME battle
   */
  start() {
    super.start();

    this.doMysteryEncounterBattle();
  }

  /** Get intro battle message for new battle */
  private getBattleMessage(): string {
    const enemyField = globalScene.getEnemyField();
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;

    if (globalScene.currentBattle.isClassicFinalBoss) {
      return i18next.t("battle:bossAppeared", { bossName: enemyField[0].name });
    }

    if (encounterMode === MysteryEncounterMode.TRAINER_BATTLE) {
      if (globalScene.currentBattle.double) {
        return i18next.t("battle:trainerAppearedDouble", {
          trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
        });
      }
      return i18next.t("battle:trainerAppeared", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      });
    }

    return enemyField.length === 1
      ? i18next.t("battle:singleWildAppeared", {
          pokemonName: enemyField[0].name,
        })
      : i18next.t("battle:multiWildAppeared", {
          pokemonName1: enemyField[0].name,
          pokemonName2: enemyField[1].name,
        });
  }

  /**
   * Queue {@linkcode SummonPhase}s for the new battle and handle trainer animations/dialogue for Trainer battles
   */
  private doMysteryEncounterBattle() {
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;
    if (encounterMode === MysteryEncounterMode.WILD_BATTLE || encounterMode === MysteryEncounterMode.BOSS_BATTLE) {
      // Summons the wild/boss Pokemon
      if (encounterMode === MysteryEncounterMode.BOSS_BATTLE) {
        globalScene.playBgm();
      }
      const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
      globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
      if (globalScene.currentBattle.double && availablePartyMembers > 1) {
        globalScene.phaseManager.unshiftNew("SummonPhase", 1, false);
      }

      if (globalScene.currentBattle.mysteryEncounter?.hideBattleIntroMessage) {
        this.endBattleSetup();
      } else {
        globalScene.ui.showText(this.getBattleMessage(), null, () => this.endBattleSetup(), 0);
      }
    } else if (encounterMode === MysteryEncounterMode.TRAINER_BATTLE) {
      this.showEnemyTrainer();
      const doSummon = () => {
        globalScene.currentBattle.started = true;
        globalScene.playBgm();
        globalScene.pbTray.showPbTray(globalScene.getPlayerParty());
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
        const doTrainerSummon = () => {
          this.hideEnemyTrainer();
          const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
          globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
          if (globalScene.currentBattle.double && availablePartyMembers > 1) {
            globalScene.phaseManager.unshiftNew("SummonPhase", 1, false);
          }
          this.endBattleSetup();
        };
        if (globalScene.currentBattle.mysteryEncounter?.hideBattleIntroMessage) {
          doTrainerSummon();
        } else {
          globalScene.ui.showText(this.getBattleMessage(), null, doTrainerSummon, 1000, true);
        }
      };

      const encounterMessages = globalScene.currentBattle.trainer?.getEncounterMessages();

      if (!encounterMessages || encounterMessages.length === 0) {
        doSummon();
      } else {
        const trainer = globalScene.currentBattle.trainer;
        let message: string;
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(encounterMessages)),
          globalScene.currentBattle.mysteryEncounter?.getSeedOffset(),
        );
        message = message!; // tell TS compiler it's defined now
        const showDialogueAndSummon = () => {
          globalScene.ui.showDialogue(message, trainer?.getName(TrainerSlot.NONE, true), null, () => {
            globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doSummon()));
          });
        };
        if (globalScene.currentBattle.trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
          globalScene
            .showFieldOverlay(500)
            .then(() =>
              globalScene.charSprite
                .showCharacter(trainer?.getKey()!, getCharVariantFromDialogue(encounterMessages[0]))
                .then(() => showDialogueAndSummon()),
            ); // TODO: is this bang correct?
        } else {
          showDialogueAndSummon();
        }
      }
    }
  }

  /**
   * Initiate {@linkcode SummonPhase}s, {@linkcode ScanIvsPhase}, {@linkcode PostSummonPhase}s, etc.
   */
  private endBattleSetup() {
    const enemyField = globalScene.getEnemyField();
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;

    // PostSummon and ShinySparkle phases are handled by SummonPhase

    if (encounterMode !== MysteryEncounterMode.TRAINER_BATTLE) {
      const ivScannerModifier = globalScene.findModifier(m => m instanceof IvScannerModifier);
      if (ivScannerModifier) {
        enemyField.map(p => globalScene.phaseManager.pushNew("ScanIvsPhase", p.getBattlerIndex()));
      }
    }

    const availablePartyMembers = globalScene.getPlayerParty().filter(p => p.isAllowedInBattle());

    if (!availablePartyMembers[0].isOnField()) {
      globalScene.phaseManager.pushNew("SummonPhase", 0);
    }

    // Format-capacity generalization (was hardcoded doubles slots 0/1): summon up to the
    // ME battle's capacity, and recall every ORPHANED wider-format slot (a previous TRIPLE
    // collapsing into this ME left slots >= capacity on the field - the lingering
    // back-sprite/info-bar class; same fix as encounter-phase). ReturnPhase is
    // party-indexed, so orphans recall correctly regardless of the new arrangement.
    const battlerCount = globalScene.currentBattle.getBattlerCount();
    const multiFormat = battlerCount > 1;
    if (multiFormat && availablePartyMembers.length > 1) {
      globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
      for (let i = 1; i < battlerCount; i++) {
        if (availablePartyMembers.length > i && !availablePartyMembers[i].isOnField()) {
          globalScene.phaseManager.pushNew("SummonPhase", i);
        }
      }
    }
    const party = globalScene.getPlayerParty();
    const hasOrphans = party.some((p, i) => i >= battlerCount && p?.isOnField());
    if (hasOrphans) {
      for (const pokemon of inSpeedOrder(ArenaTagSide.PLAYER)) {
        pokemon.lapseTag(BattlerTagType.COMMANDED);
      }
      for (let i = battlerCount; i < party.length; i++) {
        if (party[i]?.isOnField()) {
          globalScene.phaseManager.pushNew("ReturnPhase", i);
        }
      }
    }
    if (!multiFormat) {
      globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
    }

    if (
      encounterMode !== MysteryEncounterMode.TRAINER_BATTLE
      && !this.disableSwitch
      && availablePartyMembers.length > battlerCount
    ) {
      for (let i = 0; i < battlerCount; i++) {
        globalScene.phaseManager.pushNew("CheckSwitchPhase", i, multiFormat);
      }
    }

    globalScene.phaseManager.pushNew("InitEncounterPhase");
    this.end();
  }

  /** Ease in enemy trainer */
  private showEnemyTrainer(): void {
    // Show enemy trainer
    const trainer = globalScene.currentBattle.trainer;
    if (!trainer) {
      return;
    }
    trainer.alpha = 0;
    trainer.x += 16;
    trainer.y -= 16;
    trainer.setVisible(true);
    globalScene.tweens.add({
      targets: trainer,
      x: "-=16",
      y: "+=16",
      alpha: 1,
      ease: "Sine.easeInOut",
      duration: 750,
      onComplete: () => {
        trainer.untint(100, "Sine.easeOut");
        trainer.playAnim();
      },
    });
  }

  private hideEnemyTrainer(): void {
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }
}

/**
 * Will handle (in order):
 * - doContinueEncounter() callback for continuous encounters with back-to-back battles (this should push/shift its own phases as needed)
 *
 * OR
 *
 * - Any encounter reward logic that is set within {@linkcode MysteryEncounter.doEncounterExp}
 * - Any encounter reward logic that is set within {@linkcode MysteryEncounter.doEncounterRewards}
 * - Otherwise, can add a no-reward-item shop with only Potions, etc. if addHealPhase is true
 * - Queuing of the {@linkcode PostMysteryEncounterPhase}
 */
export class MysteryEncounterRewardsPhase extends Phase {
  public readonly phaseName = "MysteryEncounterRewardsPhase";
  addHealPhase: boolean;

  constructor(addHealPhase = false) {
    super();
    this.addHealPhase = addHealPhase;
  }

  /**
   * Runs {@linkcode MysteryEncounter.doContinueEncounter} and ends phase, OR {@linkcode MysteryEncounter.onRewards} then continues encounter
   */
  start() {
    super.start();
    // Co-op AUTHORITATIVE GUEST (#633, CHANGE-1 / B1): do NOT blanket early-end. The guest must run
    // the embedded reward shop as the reward WATCHER (CHANGE-2 forces host=owner, so the guest
    // adopts the host's exact streamed items). Skip the host-only engine work (onRewards /
    // doEncounterExp run on the host inside executeWithSeedOffset); only unshift the SelectModifier
    // shop the watcher runs, then push the post phase (which ends via its guest guard at :765). The
    // host-streamed reward options OVERRIDE whatever pool doEncounterRewards locally installs
    // (startCoopWatch fills typeOptions from the host's list), so running doEncounterRewards WITHOUT
    // onRewards is safe. The genuinely-interactive engine phases (OptionSelected, Post) stay diverted.
    if (isCoopAuthoritativeGuest()) {
      const guestEncounter = globalScene.currentBattle.mysteryEncounter!;
      coopLog("me", "reward-owner override: guest runs reward shop as WATCHER (host=owner)", {
        counter: coopMeInteractionStartValue(),
        hasDoEncounterRewards: !!guestEncounter.doEncounterRewards,
        addHealPhase: this.addHealPhase,
      });
      if (guestEncounter.doEncounterRewards) {
        guestEncounter.doEncounterRewards(); // unshifts the SelectModifierPhase the watcher runs
      } else if (this.addHealPhase) {
        globalScene.phaseManager.removeAllPhasesOfType("SelectModifierPhase");
        globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
          fillRemaining: false,
          rerollMultiplier: -1,
        });
      }
      globalScene.phaseManager.pushNew("PostMysteryEncounterPhase"); // ends via its guest guard (:765)
      this.end();
      return;
    }
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    if (encounter.doContinueEncounter) {
      encounter.doContinueEncounter().then(() => {
        this.end();
      });
    } else {
      globalScene.executeWithSeedOffset(() => {
        if (encounter.onRewards) {
          encounter.onRewards().then(() => {
            this.doEncounterRewardsAndContinue();
          });
        } else {
          this.doEncounterRewardsAndContinue();
        }
        // Do not use ME's seedOffset for rewards, these should always be consistent with waveIndex (once per wave)
      }, globalScene.currentBattle.waveIndex * 1000);
    }
  }

  /**
   * Queues encounter EXP and rewards phases, {@linkcode PostMysteryEncounterPhase}, and ends phase
   */
  doEncounterRewardsAndContinue() {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    if (encounter.doEncounterExp) {
      encounter.doEncounterExp();
    }

    if (encounter.doEncounterRewards) {
      encounter.doEncounterRewards();
    } else if (this.addHealPhase) {
      globalScene.phaseManager.removeAllPhasesOfType("SelectModifierPhase");
      globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
        fillRemaining: false,
        rerollMultiplier: -1,
      });
    }

    globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
    this.end();
  }
}

/**
 * Will handle (in order):
 * - {@linkcode MysteryEncounter.onPostOptionSelect} logic (based on an option that was selected)
 * - Showing any outro dialogue messages
 * - Cleanup of any leftover intro visuals
 * - Queuing of the next wave
 */
export class PostMysteryEncounterPhase extends Phase {
  public readonly phaseName = "PostMysteryEncounterPhase";
  private readonly FIRST_DIALOGUE_PROMPT_DELAY = 750;
  onPostOptionSelect?: OptionPhaseCallback | undefined;

  constructor() {
    super();
    this.onPostOptionSelect = globalScene.currentBattle.mysteryEncounter?.selectedOption?.onPostOptionPhase;
  }

  /**
   * Runs {@linkcode MysteryEncounter.onPostOptionSelect} then continues encounter
   */
  start() {
    super.start();
    // Co-op AUTHORITATIVE GUEST (#633): the guest runs no ME engine (its RNG is diverged). End this
    // phase immediately - CoopReplayMePhase is the guest's sole ME driver. CHANGE-3 (MAJOR-3): clear
    // the guest's ME pin HERE - the true post-ME boundary, AFTER the embedded watcher reward shop has
    // drained - so coopMeInProgress() stays TRUE across leaveDefensive -> the shop -> here, closing
    // the double-advance window. Solo / lockstep / host unaffected.
    if (isCoopAuthoritativeGuest()) {
      coopLog("me", "authoritative guest: PostMysteryEncounterPhase terminal (clearing pin)", {
        counter: coopMeInteractionStartValue(),
      });
      coopClearMePinForGuest();
      // #824 (THE recurring 'after the ME it doesn't continue' strand - 18:41 session and
      // every look-alike before it): this early-return skips the wave-advance the host's
      // PostME performs below, leaving the guest to whatever STALE battle-loop phases sat
      // in its queue (18:41: it resumed a phantom wave-2 battle and parked awaiting turn 4
      // forever while the host reached wave 3). Mirror the host DETERMINISTICALLY: purge
      // the stale battle loop and push exactly one NewBattlePhase - the guest's post-ME
      // boundary must never depend on leftover queue contents.
      let purged = 0;
      for (const stale of [
        "TurnInitPhase",
        "CommandPhase",
        "TurnStartPhase",
        "TurnEndPhase",
        "CoopReplayTurnPhase",
        "CoopInertPhase",
        "BattleEndPhase",
        "NewBattlePhase",
      ] as const) {
        while (globalScene.phaseManager.tryRemovePhase(stale)) {
          purged++;
        }
      }
      coopLog("me", `guest post-ME wave advance: purged ${purged} stale phases -> NewBattlePhase (#824)`);
      globalScene.phaseManager.pushNew("NewBattlePhase");
      this.end();
      return;
    }

    if (this.onPostOptionSelect) {
      globalScene.executeWithSeedOffset(async () => {
        return await this.onPostOptionSelect!().then(result => {
          if (result == null || result) {
            this.continueEncounter();
          }
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 2000);
    } else {
      this.continueEncounter();
    }
  }

  /**
   * Queues {@linkcode NewBattlePhase}, plays outro dialogue and ends phase
   */
  continueEncounter() {
    const endPhase = () => {
      // Co-op AUTHORITATIVE host (#633, CHANGE-4 / P4): UNCONDITIONALLY stream the comprehensive
      // ME-terminal resync (full party / ME-save weighting / RNG cursor / dex) AFTER all side
      // effects, BEFORE coopEndMePump. The host is the sole engine for every authoritative ME
      // (host- and guest-owned alike), so the guest's run only converges via this blob; it adopts it
      // before its leave terminal. No-op off the live authoritative host (solo / lockstep / guest).
      if (
        globalScene.gameMode.isCoop
        && getCoopNetcodeMode() === "authoritative"
        && getCoopController()?.role === "host"
        && coopMeInProgress()
      ) {
        const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
        coopLog("me", "host streams comprehensive ME-terminal resync (meResync)", {
          seq: seqMe,
          counter: coopMeInteractionStartValue(),
        });
        getCoopInteractionRelay()?.sendInteractionOutcome(seqMe, "meResync", captureCoopMeOutcome());
      }
      // Co-op (#633): the encounter is over - close the input pump (owner sends the leave
      // sentinel; host advances the alternation turn once for the whole encounter). Done before
      // queuing the next wave so the watcher's loop ends cleanly. No-op in solo.
      coopEndMePump();

      if (globalScene.gameMode.hasRandomBiomes || globalScene.isNewBiome()) {
        globalScene.phaseManager.pushNew("SelectBiomePhase");
      }

      globalScene.phaseManager.pushNew("NewBattlePhase");
      this.end();
    };

    const outroDialogue = globalScene.currentBattle?.mysteryEncounter?.dialogue?.outro;
    if (outroDialogue && outroDialogue.length > 0) {
      let i = 0;
      const showNextDialogue = () => {
        const nextAction = i === outroDialogue.length - 1 ? endPhase : showNextDialogue;
        const dialogue = outroDialogue[i];
        let title: string | null = null;
        const text: string | null = getEncounterText(dialogue.text);
        if (dialogue.speaker) {
          title = getEncounterText(dialogue.speaker);
        }

        i++;
        globalScene.ui.setMode(UiMode.MESSAGE);
        if (title) {
          globalScene.ui.showDialogue(
            text ?? "",
            title,
            null,
            nextAction,
            0,
            i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0,
          );
        } else {
          globalScene.ui.showText(text ?? "", null, nextAction, i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
        }
      };

      showNextDialogue();
    } else {
      endPhase();
    }
  }
}

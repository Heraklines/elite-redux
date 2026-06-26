import { consumeClearMeOverrideAfterFirst } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { captureCoopChecksum, captureCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
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

/** Co-op (#633): the alternation counter this ME opened on. Both clients advance the
 *  turn LOCALLY + idempotently at the ME terminal (keyed to this value), so the ME's
 *  single advance can never double-count regardless of whether the owner's terminal or
 *  the watcher's fast-forward fires first. -1 = not in an ME. */
let coopMeInteractionStart = -1;

/** Co-op (#633): whether the CURRENT phase is a mystery-encounter INTERACTIVE phase (NOT the
 *  embedded battle / reward shop). Used to guard the watcher's fast-forward so it never fires
 *  once the encounter has already been left. */
function coopInMeInteractivePhase(): boolean {
  const pn = globalScene.phaseManager.getCurrentPhase()?.phaseName;
  return (
    pn === "MysteryEncounterPhase"
    || pn === "MysteryEncounterOptionSelectedPhase"
    || pn === "MysteryEncounterRewardsPhase"
    || pn === "PostMysteryEncounterPhase"
  );
}

/** Co-op (#633): the interaction counter the in-progress ME opened on, or -1 when not in an
 *  ME. The single STABLE in-ME signal (phase-ordering-independent, unlike
 *  `currentBattle.mysteryEncounter`): the embedded end-of-ME reward shop reads it to suppress
 *  its own alternation advance, so the ME's single advance stays owned by PostMysteryEncounterPhase. */
export function coopMeInProgress(): boolean {
  return coopMeInteractionStart >= 0;
}

/**
 * Co-op authoritative non-battle ME (#633, ADD-2): the interaction counter the in-progress ME
 * pinned on (== `seq - COOP_ME_PUMP_SEQ_BASE`), or -1 when not in an ME. The host's await-and-apply
 * path + the engine sub-prompt relays (encounter-phase-utils) and the host input block (ui.ts) read
 * it to key their seq channels onto the SAME pinned counter the pump opened on, never the live
 * counter (an inbound reconcile broadcast can bump the live counter mid-ME).
 */
export function coopMeInteractionStartValue(): number {
  return coopMeInteractionStart;
}

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
  coopMeInteractionStart = counter;
  setCoopMeBattleInteractionCounter(counter);
}

/** Co-op authoritative GUEST (#633, CHANGE-3): clear the guest's ME pin at the true post-ME
 *  boundary (after the embedded watcher reward shop has drained). */
export function coopClearMePinForGuest(): void {
  coopMeInteractionStart = -1;
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
  coopMeInteractionStart = controller.interactionCounter();
  // Pin the same counter for the ME BATTLE HANDOFF key (#633): if this ME's option spawns a
  // battle, the host streams the boss party keyed by (waveIndex, this counter) and the guest
  // adopts it, so the spawned boss is identical + host-authoritative on both clients. Reset at
  // the ME terminal (coopEndMePump).
  setCoopMeBattleInteractionCounter(coopMeInteractionStart);
  const seq = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStart;
  const spoofed = getCoopRuntime()?.spoof != null;
  // Co-op AUTHORITATIVE netcode (#633, ADD-2): the HOST is the SOLE ME engine for EVERY non-battle
  // ME - host- AND guest-owned alike (the guest's diverged RNG must never run encounter logic). So
  // in authoritative mode the HOST always drives the engine (beginOwner), even when the guest OWNS
  // the ME; it then awaits the guest's relayed option index and applies it programmatically (the
  // host-await block below in MysteryEncounterPhase.start). The guest already diverted to
  // CoopReplayMePhase at :202, so only the HOST ever reaches coopBeginMePump in authoritative mode.
  // In LOCKSTEP (either client) the owner/watcher split stands byte-identical (both run the engine).
  const authoritative = getCoopNetcodeMode() === "authoritative";
  const hostDrives = authoritative
    ? controller.role === "host"
    : spoofed || controller.isLocalOwnerAtCounter(coopMeInteractionStart);
  // Resolve the ME owner from the PINNED start counter (#633), not the live counter - an
  // inbound reconcile broadcast can bump the live counter mid-encounter, which would flip
  // the owner/seq calc and desync the pump (the same drift that broke the cursor mirror).
  if (spoofed || hostDrives) {
    // #633 MAJOR-1 / B-1: in AUTHORITATIVE mode the host sends its TERMINAL sentinels (LEAVE /
    // battle-handoff) on the DEDICATED 9M terminal seq, where the authoritative guest's
    // CoopReplayMePhase.awaitHostTerminal listens (disjoint from the 8M guest->host pick relay).
    // In LOCKSTEP the terminal stays on `seq` (8M) so the watcher loop catches it byte-identically.
    const termSeq = authoritative ? COOP_ME_TERM_SEQ_BASE + coopMeInteractionStart : seq;
    pump.beginOwner(seq, termSeq);
    // Co-op AUTHORITATIVE netcode only (#633, TRACK-2 Phase C): stamp the owner's
    // authoritative full-state checksum at ME entry so the watcher can verify its ME state
    // is identical BEFORE the pump replays the button stream into it (the pump's one
    // load-bearing assumption, now self-checking). The watcher's verify+heal handler is
    // wired once in the runtime. In LOCKSTEP both clients run the full engine on the shared
    // seed, so the ME state already matches and no checksum stamp is sent (778b192dd path).
    if (authoritative) {
      getCoopBattleStreamer()?.sendMeChecksum(seq, captureCoopChecksum());
    }
  } else {
    // LOCKSTEP non-owner only (#633, ADD-2): in authoritative mode the guest diverted at :202 and
    // never reaches here, so this watcher path is lockstep-only and stays byte-identical.
    // On the leave sentinel / timeout / partner-gone, fast-forward to the next wave IF still in
    // the encounter (the rewards were already applied by the relayed picks; only the final outro
    // is skipped). Both clients advance the alternation turn LOCALLY + idempotently (keyed to the
    // ME's start counter), so whichever terminal fires first (this fast-forward or the owner's
    // coopEndMePump) advances exactly once and the other no-ops.
    //
    // On a BATTLE HANDOFF (#633): the owner's option spawned a battle. Do NOT leave the encounter
    // and do NOT advance the interaction counter - the spawned battle (+ its reward shop) still
    // runs, and the SINGLE ME advance happens at the true ME terminal (coopEndMePump) after it.
    // The watcher's input gate auto-suspends for the battle phase, so the battle command relay
    // takes over and the host drives the battle host-authoritatively.
    pump.beginWatcher(seq, {
      onLeave: () => {
        if (!coopInMeInteractivePhase()) {
          return; // already auto-completed past the encounter; its terminal already advanced
        }
        leaveEncounterWithoutBattle();
        controller.advanceInteraction(coopMeInteractionStart);
      },
      onBattleHandoff: () => {
        // No-op beyond ending the pump: the spawned battle runs via the existing host-drives /
        // guest-replays path; the counter advance is deferred to the true ME terminal.
      },
    });
  }
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
  pump.endOwner();
  // Both clients advance LOCALLY + idempotently (keyed to the ME's start counter), so the
  // whole ME (encounter + its embedded reward shop, which suppresses its own advance) counts
  // as exactly ONE alternation step on each client - no host-broadcast race (#633).
  controller.advanceInteraction(coopMeInteractionStart);
  coopMeInteractionStart = -1;
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
      // CHANGE-3: pin the ME interaction counter for the guest's WHOLE ME (so coopMeInProgress() is
      // TRUE across the embedded watcher reward shop too). Cleared at the PostMysteryEncounterPhase
      // guest guard, AFTER the shop drains (MAJOR-3), never at leaveDefensive.
      coopSetMePinForGuest(interactionCounter);
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
      const present: CoopInteractionOutcome = {
        k: "mePresent",
        tokens: { ...enc.dialogueTokens },
        meetsReqs: enc.options.map(o => o.meetsRequirements()),
        labels: enc.options.map(o => {
          const d = o.dialogue;
          if (d == null) {
            return "";
          }
          const ok = o.meetsRequirements();
          return getEncounterText(!ok && d.disabledButtonLabel ? d.disabledButtonLabel : d.buttonLabel) ?? "";
        }),
      };
      const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
      getCoopInteractionRelay()?.sendInteractionOutcome(seqMe, "mePresent", present);
    } catch {
      /* a presentation send failure must never break the host's encounter; the guest degrades to
         its local re-derivation, never a hang */
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
    void relay.awaitInteractionChoice(seqMe, COOP_ME_REPLAY_WAIT_MS).then(choice => {
      if (choice == null || choice.choice < 0) {
        // D1 null-end: a disconnected guest must never hang the host's engine - safe-leave + close.
        leaveEncounterWithoutBattle();
        coopEndMePump();
        return;
      }
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const options = this.optionSelectSettings?.overrideOptions ?? encounter.options;
      const opt = options[choice.choice];
      if (opt == null) {
        leaveEncounterWithoutBattle();
        coopEndMePump();
        return;
      }
      // ADD-2c (BLOCK-3 residual): an ME whose option chain pushes a BESPOKE interactive sub-UI
      // (ErQuizPhase / a custom OPTION_SELECT) has no generic host relay site, so resolving it on a
      // guest-owned ME would HANG the host on an un-relayed sub-screen. SAFE-DEGRADE instead: leave
      // the encounter at its default branch + close the pump, logged. Gated + closed-list; never a hang.
      if (COOP_AUTHORITATIVE_BESPOKE_SUB_ME.has(encounter.encounterType)) {
        console.log(
          `[coop-me] bespoke sub-UI on guest-owned ME ${MysteryEncounterType[encounter.encounterType]}; safe-degraded`,
        );
        leaveEncounterWithoutBattle();
        coopEndMePump();
        return;
      }
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

    if (globalScene.currentBattle.double) {
      if (availablePartyMembers.length > 1) {
        globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
        if (!availablePartyMembers[1].isOnField()) {
          globalScene.phaseManager.pushNew("SummonPhase", 1);
        }
      }
    } else {
      if (availablePartyMembers.length > 1 && availablePartyMembers[1].isOnField()) {
        for (const pokemon of inSpeedOrder(ArenaTagSide.PLAYER)) {
          pokemon.lapseTag(BattlerTagType.COMMANDED);
        }
        globalScene.phaseManager.pushNew("ReturnPhase", 1);
      }
      globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
    }

    if (encounterMode !== MysteryEncounterMode.TRAINER_BATTLE && !this.disableSwitch) {
      const minPartySize = globalScene.currentBattle.double ? 2 : 1;
      if (availablePartyMembers.length > minPartySize) {
        globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
        if (globalScene.currentBattle.double) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, globalScene.currentBattle.double);
        }
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
      coopClearMePinForGuest();
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

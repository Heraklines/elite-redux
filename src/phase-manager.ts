/**
 * Manager for phases used by battle scene.
 *
 * @remarks
 * **This file must not be imported or used directly.**
 * The manager is exclusively used by the Battle Scene and is NOT intended for external use.
 * @module
 */

import { PHASE_START_COLOR } from "#app/constants/colors";
import { DynamicQueueManager } from "#app/dynamic-queue-manager";
import { globalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { PhaseTree } from "#app/phase-tree";
import { coopRendererGateNeutralizes } from "#data/elite-redux/coop/coop-renderer-gate";
import { isCoopRecording, recordCoopMessage } from "#data/elite-redux/coop/coop-turn-recorder";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import type { Pokemon } from "#field/pokemon";
import { AddEnemyBuffModifierPhase } from "#phases/add-enemy-buff-modifier-phase";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { AttemptRunPhase } from "#phases/attempt-run-phase";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { BerryPhase } from "#phases/berry-phase";
import { BiomeShopPhase } from "#phases/biome-shop-phase";
import { BlackMarketShopPhase } from "#phases/black-market-shop-phase";
import { CheckInterludePhase } from "#phases/check-interlude-phase";
import { CheckStatusEffectPhase } from "#phases/check-status-effect-phase";
import { CheckSwitchPhase } from "#phases/check-switch-phase";
import { ColosseumChoicePhase } from "#phases/colosseum-choice-phase";
import { CommandPhase } from "#phases/command-phase";
import { CommonAnimPhase } from "#phases/common-anim-phase";
import { CoopGuestCatchFullPhase } from "#phases/coop-guest-catch-full-phase";
import { CoopGuestFaintSwitchPhase } from "#phases/coop-guest-faint-switch-phase";
import { CoopGuestRevivalPhase } from "#phases/coop-guest-revival-phase";
import { CoopInertPhase } from "#phases/coop-inert-phase";
import { CoopPartnerSyncPhase } from "#phases/coop-partner-sync-phase";
import { CoopPushReplacementCheckpointPhase } from "#phases/coop-push-replacement-checkpoint-phase";
import { CoopReplayLearnMovePhase } from "#phases/coop-replay-learn-move-phase";
import { CoopTurnCommitPhase } from "#phases/coop-turn-commit-phase";
// #848: side-effect import so the guest's INLINE batch Move Learn panel opener registers with the coop
// runtime at boot (the shared co-op level-up path). It exports no phase, so it needs an explicit import.
import "#phases/coop-replay-learn-move-batch";
import { CoopReplayMePhase } from "#phases/coop-replay-me-phase";
import {
  CoopApplyResyncPhase,
  CoopCaptureReplayPhase,
  CoopFaintReplayPhase,
  CoopFinalizeTurnPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
  CoopStatStageReplayPhase,
  CoopStatusReplayPhase,
} from "#phases/coop-replay-phases";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { CoopVictorySealPhase } from "#phases/coop-victory-seal-phase";
import { DamageAnimPhase } from "#phases/damage-anim-phase";
import { DynamicPhaseMarker } from "#phases/dynamic-phase-marker";
import { EggHatchPhase } from "#phases/egg-hatch-phase";
import { EggLapsePhase } from "#phases/egg-lapse-phase";
import { EggSummaryPhase } from "#phases/egg-summary-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { EndCardPhase } from "#phases/end-card-phase";
import { EndEvolutionPhase } from "#phases/end-evolution-phase";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { ErAbilityCapsulePhase } from "#phases/er-ability-capsule-phase";
import { ErClosedCircuitBurstPhase } from "#phases/er-closed-circuit-burst-phase";
import { ErCrossroadsPhase } from "#phases/er-crossroads-phase";
import { ErDexNavPhase } from "#phases/er-dex-nav-phase";
import { ErGreaterAbilityCapsulePhase } from "#phases/er-greater-ability-capsule-phase";
import { ErGreaterAbilityRandomizerPhase } from "#phases/er-greater-ability-randomizer-phase";
import { ErOmniformTransformWaitPhase } from "#phases/er-omniform-transform-wait-phase";
import { ErQuizPhase } from "#phases/er-quiz-phase";
import { ErShatteredPsycheBonusPhase } from "#phases/er-shattered-psyche-bonus-phase";
import { ErStormglassPickerPhase } from "#phases/er-stormglass-picker-phase";
import { EvolutionPhase } from "#phases/evolution-phase";
import { ExoticShopPhase } from "#phases/exotic-shop-phase";
import { ExpPhase } from "#phases/exp-phase";
import { FaintPhase } from "#phases/faint-phase";
import { FormChangePhase } from "#phases/form-change-phase";
import { GameOverModifierRewardPhase } from "#phases/game-over-modifier-reward-phase";
import { GameOverPhase } from "#phases/game-over-phase";
import { HideAbilityPhase } from "#phases/hide-ability-phase";
import { HidePartyExpBarPhase } from "#phases/hide-party-exp-bar-phase";
import { ImportBazaarShopPhase } from "#phases/import-bazaar-shop-phase";
import { InitEncounterPhase } from "#phases/init-encounter-phase";
import { LearnMoveBatchPhase } from "#phases/learn-move-batch-phase";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { LevelCapPhase } from "#phases/level-cap-phase";
import { LevelUpPhase } from "#phases/level-up-phase";
import { LLMDirectorBeatPhase } from "#phases/llm-director-beat-phase";
import { LLMDirectorBiblePhase } from "#phases/llm-director-bible-phase";
import { LLMDirectorStartPhase } from "#phases/llm-director-start-phase";
import { LoadMoveAnimPhase } from "#phases/load-move-anim-phase";
import { LoginPhase } from "#phases/login-phase";
import { MessagePhase } from "#phases/message-phase";
import { ModifierRewardPhase } from "#phases/modifier-reward-phase";
import { MoneyRewardPhase } from "#phases/money-reward-phase";
import { MoveAnimPhase } from "#phases/move-anim-phase";
import { MoveChargePhase } from "#phases/move-charge-phase";
import { MoveEffectPhase } from "#phases/move-effect-phase";
import { MoveEndPhase } from "#phases/move-end-phase";
import { MoveHeaderPhase } from "#phases/move-header-phase";
import { MovePhase } from "#phases/move-phase";
import { MoveReflectPhase } from "#phases/move-reflect-phase";
import {
  MysteryEncounterBattlePhase,
  MysteryEncounterBattleStartCleanupPhase,
  MysteryEncounterOptionSelectedPhase,
  MysteryEncounterPhase,
  MysteryEncounterRewardsPhase,
  PostMysteryEncounterPhase,
} from "#phases/mystery-encounter-phases";
import { NewBattlePhase } from "#phases/new-battle-phase";
import { NewBiomeEncounterPhase } from "#phases/new-biome-encounter-phase";
import { NextEncounterPhase } from "#phases/next-encounter-phase";
import { ObtainStatusEffectPhase } from "#phases/obtain-status-effect-phase";
import { PartyExpPhase } from "#phases/party-exp-phase";
import { PartyHealPhase } from "#phases/party-heal-phase";
import { PokemonAnimPhase } from "#phases/pokemon-anim-phase";
import { PokemonHealPhase } from "#phases/pokemon-heal-phase";
import { PokemonTransformPhase } from "#phases/pokemon-transform-phase";
import { PositionalTagPhase } from "#phases/positional-tag-phase";
import { PostGameOverPhase } from "#phases/post-game-over-phase";
import { PostSummonPhase } from "#phases/post-summon-phase";
import { PostTurnStatusEffectPhase } from "#phases/post-turn-status-effect-phase";
import { QuietFormChangePhase } from "#phases/quiet-form-change-phase";
import { ReloadSessionPhase } from "#phases/reload-session-phase";
import { ResetStatusPhase } from "#phases/reset-status-phase";
import { ReturnPhase } from "#phases/return-phase";
import { RevivalBlessingPhase } from "#phases/revival-blessing-phase";
import { RibbonModifierRewardPhase } from "#phases/ribbon-modifier-reward-phase";
import { ScanIvsPhase } from "#phases/scan-ivs-phase";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { SelectChallengePhase } from "#phases/select-challenge-phase";
import { SelectGenderPhase } from "#phases/select-gender-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { SelectTargetPhase } from "#phases/select-target-phase";
import { ShiftSummonPhase } from "#phases/shift-summon-phase";
import { ShinySparklePhase } from "#phases/shiny-sparkle-phase";
import { ShowAbilityPhase } from "#phases/show-ability-phase";
import { ShowPartyExpBarPhase } from "#phases/show-party-exp-bar-phase";
import { ShowTrainerPhase } from "#phases/show-trainer-phase";
import { ShowdownEnemyFaintSwitchPhase } from "#phases/showdown-enemy-faint-switch-phase";
import { ShowdownResultPhase } from "#phases/showdown-result-phase";
import { StatStageChangePhase } from "#phases/stat-stage-change-phase";
import { SummonMissingPhase } from "#phases/summon-missing-phase";
import { SummonPhase } from "#phases/summon-phase";
import { SwitchBiomePhase } from "#phases/switch-biome-phase";
import { SwitchPhase } from "#phases/switch-phase";
import { SwitchSummonPhase } from "#phases/switch-summon-phase";
import { TeraPhase } from "#phases/tera-phase";
import { TheBargainPhase } from "#phases/the-bargain-phase";
import { TitlePhase } from "#phases/title-phase";
import { ToggleDoublePositionPhase } from "#phases/toggle-double-position-phase";
import { TrainerVictoryPhase } from "#phases/trainer-victory-phase";
import { TurnEndPhase } from "#phases/turn-end-phase";
import { TurnInitPhase } from "#phases/turn-init-phase";
import { TurnStartPhase } from "#phases/turn-start-phase";
import { UnavailablePhase } from "#phases/unavailable-phase";
import { UnlockPhase } from "#phases/unlock-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { WeatherEffectPhase } from "#phases/weather-effect-phase";
import type { PhaseConditionFunc, PhaseMap, PhaseString } from "#types/phase-types";
import type { NonEmptyTuple } from "type-fest";

/**
 * Object that holds all of the phase constructors.
 * This is used to create new phases dynamically using the `newPhase` method in the `PhaseManager`.
 *
 * @remarks
 * The keys of this object are the names of the phases, and the values are the constructors of the phases.
 * This allows for easy creation of new phases without needing to import each phase individually.
 */
const PHASES = Object.freeze({
  AddEnemyBuffModifierPhase,
  AttemptCapturePhase,
  AttemptRunPhase,
  BattleEndPhase,
  BerryPhase,
  BiomeShopPhase,
  BlackMarketShopPhase,
  ColosseumChoicePhase,
  TheBargainPhase,
  ExoticShopPhase,
  ImportBazaarShopPhase,
  ErAbilityCapsulePhase,
  ErGreaterAbilityCapsulePhase,
  ErGreaterAbilityRandomizerPhase,
  ErClosedCircuitBurstPhase,
  ErOmniformTransformWaitPhase,
  ErShatteredPsycheBonusPhase,
  ErCrossroadsPhase,
  ErQuizPhase,
  ErStormglassPickerPhase,
  CheckInterludePhase,
  CheckStatusEffectPhase,
  CheckSwitchPhase,
  CommandPhase,
  CoopReplayTurnPhase,
  CoopReplayMePhase,
  CoopReplayLearnMovePhase,
  CoopGuestCatchFullPhase,
  CoopGuestFaintSwitchPhase,
  CoopGuestRevivalPhase,
  CoopPartnerSyncPhase,
  CoopInertPhase,
  CoopPushReplacementCheckpointPhase,
  CoopTurnCommitPhase,
  CoopApplyResyncPhase,
  CoopCaptureReplayPhase,
  CoopFinalizeTurnPhase,
  CoopFaintReplayPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
  CoopStatStageReplayPhase,
  CoopStatusReplayPhase,
  CoopVictorySealPhase,
  CommonAnimPhase,
  DamageAnimPhase,
  DynamicPhaseMarker,
  EggHatchPhase,
  EggLapsePhase,
  EggSummaryPhase,
  EncounterPhase,
  EndCardPhase,
  EndEvolutionPhase,
  EnemyCommandPhase,
  ErDexNavPhase,
  EvolutionPhase,
  ExpPhase,
  FaintPhase,
  FormChangePhase,
  GameOverPhase,
  GameOverModifierRewardPhase,
  HideAbilityPhase,
  HidePartyExpBarPhase,
  InitEncounterPhase,
  LearnMoveBatchPhase,
  LearnMovePhase,
  LLMDirectorBeatPhase,
  LLMDirectorBiblePhase,
  LLMDirectorStartPhase,
  LevelCapPhase,
  LevelUpPhase,
  LoadMoveAnimPhase,
  LoginPhase,
  MessagePhase,
  ModifierRewardPhase,
  MoneyRewardPhase,
  MoveAnimPhase,
  MoveChargePhase,
  MoveEffectPhase,
  MoveEndPhase,
  MoveHeaderPhase,
  MoveReflectPhase,
  MovePhase,
  MysteryEncounterPhase,
  MysteryEncounterOptionSelectedPhase,
  MysteryEncounterBattlePhase,
  MysteryEncounterBattleStartCleanupPhase,
  MysteryEncounterRewardsPhase,
  PostMysteryEncounterPhase,
  NewBattlePhase,
  NewBiomeEncounterPhase,
  NextEncounterPhase,
  ObtainStatusEffectPhase,
  PartyExpPhase,
  PartyHealPhase,
  PokemonAnimPhase,
  PokemonHealPhase,
  PokemonTransformPhase,
  PositionalTagPhase,
  PostGameOverPhase,
  PostSummonPhase,
  PostTurnStatusEffectPhase,
  QuietFormChangePhase,
  ReloadSessionPhase,
  ResetStatusPhase,
  ReturnPhase,
  RevivalBlessingPhase,
  RibbonModifierRewardPhase,
  ScanIvsPhase,
  SelectBiomePhase,
  SelectChallengePhase,
  SelectGenderPhase,
  SelectModifierPhase,
  SelectStarterPhase,
  SelectTargetPhase,
  ShiftSummonPhase,
  ShinySparklePhase,
  ShowAbilityPhase,
  ShowdownEnemyFaintSwitchPhase,
  ShowdownResultPhase,
  ShowPartyExpBarPhase,
  ShowTrainerPhase,
  StatStageChangePhase,
  SummonMissingPhase,
  SummonPhase,
  SwitchBiomePhase,
  SwitchPhase,
  SwitchSummonPhase,
  TeraPhase,
  TitlePhase,
  ToggleDoublePositionPhase,
  TrainerVictoryPhase,
  TurnEndPhase,
  TurnInitPhase,
  TurnStartPhase,
  UnavailablePhase,
  UnlockPhase,
  VictoryPhase,
  WeatherEffectPhase,
});

// This type export cannot be moved to `@types`, as `Phases` is intentionally private to this file
/** Maps Phase strings to their constructors */
export type PhaseConstructorMap = typeof PHASES;

/** Phases pushed at the end of each {@linkcode TurnStartPhase} */
const turnEndPhases: readonly PhaseString[] = [
  "WeatherEffectPhase",
  "PositionalTagPhase",
  "BerryPhase",
  "CheckStatusEffectPhase",
  "TurnEndPhase",
] as const;

/**
 * The `PhaseManager` is responsible for managing the phases in the Battle Scene.
 */
export class PhaseManager {
  /** A multi-dimensional queue of phases being run. */
  // TODO: Consider renaming given this is no longer a simple queue
  private readonly phaseQueue: PhaseTree = new PhaseTree();

  /** Holds priority queues for dynamically ordered phases */
  public dynamicQueueManager = new DynamicQueueManager();

  /** The currently-running {@linkcode Phase}. */
  private currentPhase: Phase;
  /** The phase put on standby if {@linkcode overridePhase} is called */
  private standbyPhase: Phase | null = null;
  /**
   * Terminal fence for a co-op runtime that is retaining its peer-ACKed shutdown transaction. The current
   * phase may receive late async completions while that handshake runs; blocking `shiftPhase` prevents
   * those completions from rebuilding a turn after the gameplay queues were drained.
   */
  private coopTerminalProgressionFrozen = false;

  /**
   * Clear all previously set phases, then add a new {@linkcode TitlePhase} to transition to the title screen.
   * @param addLogin - Whether to add a new {@linkcode LoginPhase} before the {@linkcode TitlePhase}
   * (but reset everything else).
   * Default `false`
   */
  public toTitleScreen(addLogin = false): void {
    this.clearAllPhases();

    if (addLogin) {
      this.unshiftNew("LoginPhase");
    }
    this.unshiftNew("TitlePhase");
  }

  // #region Phase Functions

  /** @returns The currently running {@linkcode Phase}. */
  getCurrentPhase(): Phase {
    return this.currentPhase;
  }

  getStandbyPhase(): Phase | null {
    return this.standbyPhase;
  }

  /**
   * #diagnostics: the names of the queued phases, in the order they will run (read-only). Assembled on
   * demand for a co-op bug report's control-plane block so a stuck queue's shape is captured with the
   * report. Covers the static phase queue (the dynamic-queue manager holds only transient in-turn phases).
   */
  getQueuedPhaseNames(): string[] {
    return this.phaseQueue.queuedPhaseNames();
  }

  /**
   * Add one or more Phases to the end of the queue.
   * They will run once all phases already in the queue have ended.
   * @param phases - One or more {@linkcode Phase}s to add
   */
  public pushPhase(...phases: NonEmptyTuple<Phase>): void {
    for (const phase of phases) {
      this.phaseQueue.pushPhase(this.checkDynamic(phase));
    }
  }

  /**
   * Queue one or more phases to be run immediately after the current phase finishes. \
   * Unshifted phases are run in FIFO order if multiple are queued during a single phase's execution.
   * @param phases - One or more {@linkcode Phase}s to add
   * @privateRemarks
   * Any newly-unshifted `MovePhase`s will be queued after the next `MoveEndPhase`.
   */
  // NB: I'd like to restrict this to only allow passing 1 `MovePhase` at a time, but this causes TS to
  // flip the hell out with `Parameters`...
  public unshiftPhase(...phases: NonEmptyTuple<Phase>): void {
    for (const phase of phases) {
      const toAdd = this.checkDynamic(phase);
      if (phase.is("MovePhase")) {
        this.phaseQueue.addAfter(toAdd, "MoveEndPhase");
      } else {
        this.phaseQueue.addPhase(toAdd);
      }
    }
  }

  /**
   * Helper method to queue a phase as dynamic if necessary
   * @param phase - The phase to check
   * @returns The {@linkcode Phase} or a {@linkcode DynamicPhaseMarker} to be used in its place
   */
  private checkDynamic(phase: Phase): Phase {
    if (this.dynamicQueueManager.queueDynamicPhase(phase)) {
      return new DynamicPhaseMarker(phase.phaseName);
    }
    return phase;
  }

  /**
   * Clear all Phases from the queue.
   * @param leaveUnshifted - If `true`, leaves the top level of the tree intact; default `false`
   */
  public clearPhaseQueue(leaveUnshifted = false): void {
    this.phaseQueue.clear(leaveUnshifted);
  }

  /** Clear all phase queues and the standby phase. */
  public clearAllPhases(): void {
    this.clearPhaseQueue();
    this.dynamicQueueManager.clearQueues();
    this.standbyPhase = null;
  }

  /** Freeze phase progression at the current surface while a co-op shared terminal is retained. */
  public freezeForCoopTerminal(): void {
    this.coopTerminalProgressionFrozen = true;
    this.clearAllPhases();
  }

  /** Release the terminal fence immediately before exactly-once title teardown. */
  public releaseCoopTerminalFreeze(): void {
    this.coopTerminalProgressionFrozen = false;
  }

  /** Read-only proof used by terminal wiring tests and diagnostics. */
  public isCoopTerminalFrozen(): boolean {
    return this.coopTerminalProgressionFrozen;
  }

  /**
   * Determine the next phase to run and start it.
   * @privateRemarks
   * This is called by {@linkcode Phase.end} by default, and should not be called by other methods.
   */
  public shiftPhase(): void {
    if (this.coopTerminalProgressionFrozen) {
      return;
    }
    if (this.standbyPhase) {
      this.currentPhase = this.standbyPhase;
      this.standbyPhase = null;
      return;
    }

    let nextPhase = this.phaseQueue.getNextPhase();

    if (nextPhase?.is("DynamicPhaseMarker")) {
      nextPhase = this.dynamicQueueManager.popNextPhase(nextPhase.phaseType);
    }

    if (nextPhase == null) {
      this.turnStart();
    } else {
      this.currentPhase = nextPhase;
    }

    this.startCurrentPhase();
  }

  /**
   * Helper method to start and log the current phase.
   *
   * @privateRemarks
   * This is disabled during tests by `phase-interceptor.ts` to allow for pausing execution at specific phases.
   * As such, **do not remove or split this method** as it will break integration tests.
   */
  private startCurrentPhase(): void {
    console.log(`%cStart Phase ${this.currentPhase.phaseName}`, `color:${PHASE_START_COLOR};`);
    this.currentPhase.start();
  }

  /**
   * Override the currently running phase with another
   * @param phase - The {@linkcode Phase} to override the current one with
   * @returns If the override succeeded
   *
   * @todo This is antithetical to the phase structure and used a single time. Remove it.
   */
  public overridePhase(phase: Phase): boolean {
    if (this.standbyPhase) {
      return false;
    }

    this.standbyPhase = this.currentPhase;
    this.currentPhase = phase;
    this.startCurrentPhase();

    return true;
  }

  /**
   * Determine if there is a queued {@linkcode Phase} meeting the specified conditions.
   * @param name - The {@linkcode PhaseString | name} of the Phase to search for
   * @param condition - An optional {@linkcode PhaseConditionFunc} to add conditions to the search
   * @returns Whether a matching phase exists
   */
  public hasPhaseOfType<T extends PhaseString>(name: T, condition?: PhaseConditionFunc<T>): boolean {
    return this.dynamicQueueManager.exists(name, condition) || this.phaseQueue.exists(name, condition);
  }

  /**
   * Attempt to find and remove the first queued {@linkcode Phase} meeting the given condition.
   * @param name - The {@linkcode PhaseString | name} of the Phase to search for
   * @param phaseFilter - An optional {@linkcode PhaseConditionFunc} to add conditions to the search
   * @returns Whether a phase was successfully removed
   */
  public tryRemovePhase<T extends PhaseString>(name: T, phaseFilter?: PhaseConditionFunc<T>): boolean {
    return this.dynamicQueueManager.removePhase(name, phaseFilter) || this.phaseQueue.remove(name, phaseFilter);
  }

  /**
   * Remove all instances of the given {@linkcode Phase}.
   * @param name - The {@linkcode PhaseString | name} of the `Phase` to remove
   *
   * @remarks
   * This is not intended to be used with dynamically ordered phases, and does not operate on the dynamic queue. \
   * However, it does remove {@linkcode DynamicPhaseMarker}s and so would prevent such phases from activating.
   */
  public removeAllPhasesOfType(name: PhaseString): void {
    this.phaseQueue.removeAll(name);
  }

  /**
   * Add a `MessagePhase` to the queue.
   * @param message - string for MessagePhase
   * @param callbackDelay - optional param for MessagePhase constructor
   * @param prompt - optional param for MessagePhase constructor
   * @param promptDelay - optional param for MessagePhase constructor
   * @param defer - If `true`, push the phase instead of unshifting; default `false`
   *
   * @see {@linkcode MessagePhase} for more details on the parameters
   */
  queueMessage(
    message: string,
    callbackDelay?: number | null,
    prompt?: boolean | null,
    promptDelay?: number | null,
    defer?: boolean | null,
  ) {
    // Co-op host turn recorder (#633, TRACK-2 Phase B): while the host is resolving a
    // turn it records each narration line so it can stream the ordered events to the
    // guest (which renders them + computes nothing). Inert unless a recording is open
    // (only the host, mid-turn, in a live co-op run) - solo is byte-for-byte unaffected.
    if (isCoopRecording()) {
      recordCoopMessage(message);
    }
    // Co-op ME narration (#633, ADD-3) is streamed to the guest from `ui.showText` / `ui.showDialogue`
    // at the actual render site, NOT here: every queued message flows through `MessagePhase` ->
    // `ui.showText`, so hooking here too would stream each ME line TWICE (the guest would render the
    // duplicate). The render-site hook is the single, in-order source of truth.
    const phase = new MessagePhase(message, callbackDelay, prompt, promptDelay);
    if (defer) {
      this.pushPhase(phase);
    } else {
      this.unshiftPhase(phase);
    }
  }

  /**
   * Queue an ability bar flyout phase via {@linkcode unshiftPhase}
   * @param pokemon - The {@linkcode Pokemon} whose ability is being activated
   * @param passive - Whether the ability is a passive
   * @param show - If `true`, show the bar. Otherwise, hide it
   * @param passiveSlot - When `passive` is `true`, which of the 3 ER passive slots
   *   (0, 1, or 2) is being displayed. Defaults to slot 0 for legacy callers.
   *   Ignored when `passive` is `false` or `show` is `false` (hide doesn't read
   *   the slot — the bar is just being dismissed).
   */
  public queueAbilityDisplay(pokemon: Pokemon, passive: boolean, show: boolean, passiveSlot: 0 | 1 | 2 = 0): void {
    this.unshiftPhase(
      show ? new ShowAbilityPhase(pokemon.getBattlerIndex(), passive, passiveSlot) : new HideAbilityPhase(),
    );
  }

  /**
   * Hide the ability bar if it is currently visible.
   */
  public hideAbilityBar(): void {
    if (globalScene.abilityBar.isVisible()) {
      this.unshiftPhase(new HideAbilityPhase());
    }
  }

  /**
   * Clear all dynamic queues and begin a new {@linkcode TurnInitPhase} for the current turn.
   * Called whenever the current phase queue is empty.
   */
  private turnStart(): void {
    this.dynamicQueueManager.clearQueues();
    this.currentPhase = new TurnInitPhase();
  }

  /**
   * Dynamically create the named phase from the provided arguments.
   *
   * @param phase - The name of the phase to create.
   * @param args - The arguments to pass to the phase constructor.
   * @returns The created phase instance.
   * @remarks
   * Used to avoid importing each phase individually, allowing for dynamic creation of phases.
   */
  public create<T extends PhaseString>(phase: T, ...args: ConstructorParameters<PhaseConstructorMap[T]>): PhaseMap[T] {
    const PhaseClass = PHASES[phase];

    if (!PhaseClass) {
      throw new Error(`Phase ${phase} does not exist in PhaseMap.`);
    }

    // Co-op RENDERER ALLOWLIST gate (#633 -> allowlist; accepted-review item 2). The authoritative
    // co-op GUEST is a pure renderer that resolves nothing: it renders the host's streamed outcome
    // via the CoopReplay* phases and applies the host's authoritative checkpoint. Only presentation +
    // input-intent phases (+ the transitional boundary tails) may be constructed on it; every other
    // phase is a host-authoritative RESOLUTION / progression / reward LEAK. ENFORCE is the shipped default:
    // every unlisted phase fails closed (neutralize + logged BLOCK). OBSERVE remains an explicit emergency
    // rollback that preserves legacy behavior and logs WOULD-BLOCK. When the gate neutralizes,
    // substitute an inert no-op that occupies the queue slot and advances immediately - it can never
    // roll RNG, apply damage, or read per-account state. Hard-gated on the live authoritative GUEST, so
    // solo / host / lockstep are byte-for-byte unaffected (the predicate is false and this returns
    // early). See coop-renderer-gate.ts + docs/plans/2026-07-10-coop-authoritative-run-state-migration.md.
    if (coopRendererGateNeutralizes(phase, args)) {
      // The inert phase legitimately substitutes for ANY neutralized phase; every consumer of create()
      // only ENQUEUES the result as a base `Phase` (verified: no caller reads a neutralized phase's
      // methods), so this is a sound deliberate substitution, not an error suppression.
      return new CoopInertPhase(phase) as unknown as PhaseMap[T];
    }

    // @ts-expect-error: Typescript does not support narrowing the type of operands in generic methods (see https://stackoverflow.com/a/72891234)
    const created = new PhaseClass(...args) as PhaseMap[T];
    // CoopReplayTurnPhase is an async authority renderer: by the time its network wait resumes, the
    // ambient global scene is not a reliable owner in the in-process two-browser scheduler. Bind it at
    // the factory boundary, where this manager is the definitive phase-tree owner. Production still has
    // one manager/browser; this makes that existing ownership explicit without changing queue order.
    if (created instanceof CoopReplayTurnPhase) {
      created.bindOwnerPhaseManager(this);
    }
    return created;
  }

  /**
   * Create a new phase and immediately push it to the phase queue.
   * Equivalent to calling {@linkcode create} followed by {@linkcode pushPhase}.
   * @param phase - The name of the phase to create
   * @param args - The arguments to pass to the phase constructor
   */
  public pushNew<T extends PhaseString>(phase: T, ...args: ConstructorParameters<PhaseConstructorMap[T]>): void {
    this.pushPhase(this.create(phase, ...args));
  }

  /**
   * Create a new phase and immediately unshift it to the phase queue.
   * Equivalent to calling {@linkcode create} followed by {@linkcode unshiftPhase}.
   * @param phase - The name of the phase to create
   * @param args - The arguments to pass to the phase constructor
   */
  public unshiftNew<T extends PhaseString>(phase: T, ...args: ConstructorParameters<PhaseConstructorMap[T]>): void {
    this.unshiftPhase(this.create(phase, ...args));
  }

  /**
   * Queue the authoritative co-op commit after the current phase's complete child subtree,
   * but before its pre-existing faint, victory, or next-turn siblings.
   */
  public queueCoopTurnCommitPhase(): void {
    this.phaseQueue.addBarrier(this.create("CoopTurnCommitPhase"));
  }

  /**
   * Add a {@linkcode FaintPhase} to the queue.
   * @param args - The arguments to pass to the phase constructor
   *
   * @remarks
   *
   * Faint phases are ordered in a special way to allow battle effects to settle before the Pokemon faints.
   * @see {@linkcode PhaseTree.addPhase}
   */
  public queueFaintPhase(...args: ConstructorParameters<PhaseConstructorMap["FaintPhase"]>): void {
    this.phaseQueue.addPhase(this.create("FaintPhase", ...args), true);
  }

  /**
   * Create a new phase and queue it to run after all others queued by the currently running phase.
   * @param phase - The name of the phase to create
   * @param args - The arguments to pass to the phase constructor
   *
   * @deprecated Only used for switches and should be phased out eventually.
   */
  public queueDeferred<const T extends "SwitchPhase" | "SwitchSummonPhase">(
    phase: T,
    ...args: ConstructorParameters<PhaseConstructorMap[T]>
  ): void {
    this.phaseQueue.addPhase(this.create(phase, ...args), true);
  }

  /**
   * Find and return the first {@linkcode MovePhase} meeting the given condition.
   * @param phaseCondition - The {@linkcode PhaseConditionFunc | condition} function used to retrieve the phase
   * @returns The retrieved `MovePhase`, or `undefined` if none meet the criteria.
   */
  public getMovePhase(phaseCondition: PhaseConditionFunc<"MovePhase">): MovePhase | undefined {
    return this.dynamicQueueManager.getMovePhase(phaseCondition);
  }

  /**
   * Find and cancel the first {@linkcode MovePhase} meeting the given condition.
   * @param phaseCondition - The {@linkcode PhaseConditionFunc | condition} function used to retrieve the phase
   */
  public cancelMove(phaseCondition: PhaseConditionFunc<"MovePhase">): void {
    this.dynamicQueueManager.cancelMovePhase(phaseCondition);
  }

  /**
   * Find and forcibly reorder the first {@linkcode MovePhase} meeting the given condition to move next.
   * @param phaseCondition - The {@linkcode PhaseConditionFunc | condition} function used to retrieve the phase
   */
  public forceMoveNext(phaseCondition: PhaseConditionFunc<"MovePhase">): void {
    this.dynamicQueueManager.setMoveTimingModifier(phaseCondition, MovePhaseTimingModifier.FIRST);
  }

  /**
   * Find and forcibly reorder the first {@linkcode MovePhase} meeting the given condition to move last.
   * @param phaseCondition - The {@linkcode PhaseConditionFunc | condition} function used to retrieve the phase
   */
  public forceMoveLast(phaseCondition: PhaseConditionFunc<"MovePhase">): void {
    this.dynamicQueueManager.setMoveTimingModifier(phaseCondition, MovePhaseTimingModifier.LAST);
  }

  /**
   * Redirect moves which were targeted at a {@linkcode Pokemon} that has been removed
   * @param removedPokemon - The removed {@linkcode Pokemon}
   * @param allyPokemon - The ally of the removed pokemon
   */
  public redirectMoves(removedPokemon: Pokemon, allyPokemon: Pokemon): void {
    this.dynamicQueueManager.redirectMoves(removedPokemon, allyPokemon);
  }

  /** Queue phases which run at the end of each turn. */
  public queueTurnEndPhases(): void {
    turnEndPhases.forEach(p => {
      this.pushNew(p);
    });
  }

  /** Prevent end of turn effects from triggering when transitioning to a new biome on a X0 wave. */
  public onInterlude(): void {
    const phasesToRemove: readonly PhaseString[] = [
      "WeatherEffectPhase",
      "BerryPhase",
      "CheckStatusEffectPhase",
    ] as const;
    for (const phaseName of phasesToRemove) {
      this.phaseQueue.removeAll(phaseName);
    }

    const turnEndPhase = this.phaseQueue.find("TurnEndPhase");
    if (turnEndPhase) {
      turnEndPhase.upcomingInterlude = true;
    }
  }
  // #endregion Phase Functions
}

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
import { coopMeHandoffBattleStarted, coopMeInProgress } from "#data/elite-redux/coop/coop-me-pin-state";
import type { CoopMutationLedger, CoopMutationToken } from "#data/elite-redux/coop/coop-mutation-ledger";
import { coopRendererGateNeutralizes } from "#data/elite-redux/coop/coop-renderer-gate";
import { isCoopRecording, recordCoopMessage } from "#data/elite-redux/coop/coop-turn-recorder";
import type { AbilityId } from "#enums/ability-id";
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
import { CoopGuestColosseumChoicePhase } from "#phases/coop-guest-colosseum-choice-phase";
import { CoopGuestFaintSwitchPhase } from "#phases/coop-guest-faint-switch-phase";
import { CoopGuestRevivalPhase } from "#phases/coop-guest-revival-phase";
import { CoopInertPhase } from "#phases/coop-inert-phase";
import { CoopPartnerSyncPhase } from "#phases/coop-partner-sync-phase";
import { CoopPushReplacementCheckpointPhase } from "#phases/coop-push-replacement-checkpoint-phase";
import { CoopReplayLearnMoveBatchPhase } from "#phases/coop-replay-learn-move-batch";
import { CoopReplayLearnMovePhase } from "#phases/coop-replay-learn-move-phase";
import { CoopReplayMePhase } from "#phases/coop-replay-me-phase";
import {
  CoopAppearanceReplayPhase,
  CoopApplyResyncPhase,
  CoopCaptureReplayPhase,
  CoopCommonAnimReplayPhase,
  CoopFaintReplayPhase,
  CoopFinalizeEntryPresentationPhase,
  CoopFinalizeTurnPhase,
  CoopFormChangeReplayPhase,
  CoopHideAbilityReplayPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
  CoopShinySparkleReplayPhase,
  CoopShowAbilityReplayPhase,
  CoopStatStageReplayPhase,
  CoopStatusReplayPhase,
  CoopSwitchReplayPhase,
  CoopTeraReplayPhase,
  CoopTransformReplayPhase,
} from "#phases/coop-replay-phases";
import { CoopPresentationReceiptPhase, CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { CoopTurnCommitPhase } from "#phases/coop-turn-commit-phase";
import { CoopVictorySealPhase } from "#phases/coop-victory-seal-phase";
import { CoopWaveProgressionReplayPhase } from "#phases/coop-wave-progression-replay-phase";
import { DamageAnimPhase } from "#phases/damage-anim-phase";
import { DynamicPhaseMarker } from "#phases/dynamic-phase-marker";
import { EggHatchPhase } from "#phases/egg-hatch-phase";
import { EggLapsePhase } from "#phases/egg-lapse-phase";
import { EggSummaryPhase } from "#phases/egg-summary-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { EndCardPhase } from "#phases/end-card-phase";
import { EndEvolutionPhase } from "#phases/end-evolution-phase";
import { EndlessContinuationPhase } from "#phases/endless-continuation-phase";
import { EndlessOfferPhase } from "#phases/endless-offer-phase";
import { EndlessRiftPulsePhase } from "#phases/endless-rift-pulse-phase";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { ErAbilityCapsulePhase } from "#phases/er-ability-capsule-phase";
import { ErClosedCircuitBurstPhase } from "#phases/er-closed-circuit-burst-phase";
import { ErCrossroadsPhase } from "#phases/er-crossroads-phase";
import { ErDexNavPhase } from "#phases/er-dex-nav-phase";
import { ErGreaterAbilityCapsulePhase } from "#phases/er-greater-ability-capsule-phase";
import { ErGreaterAbilityRandomizerPhase } from "#phases/er-greater-ability-randomizer-phase";
import { ErGreaterMoveRandomizerPhase } from "#phases/er-greater-move-randomizer-phase";
import { ErOmniformTransformWaitPhase } from "#phases/er-omniform-transform-wait-phase";
import { ErQuizPhase } from "#phases/er-quiz-phase";
import { ErShatteredPsycheBonusPhase } from "#phases/er-shattered-psyche-bonus-phase";
import { ErSignatureFollowupPhase } from "#phases/er-signature-followup-phase";
import { ErStormglassPickerPhase } from "#phases/er-stormglass-picker-phase";
import { EvolutionPhase } from "#phases/evolution-phase";
import { ExoticShopPhase } from "#phases/exotic-shop-phase";
import { ExpPhase } from "#phases/exp-phase";
import { FaintPhase } from "#phases/faint-phase";
import { CoopFormChangeCutsceneReplayPhase, FormChangePhase } from "#phases/form-change-phase";
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
import {
  MoodyCoordinatorChoicePhase,
  MoodyCoordinatorConfirmPhase,
  MoodyCoordinatorOperationPhase,
  MoodyCoordinatorPokemonChoicePhase,
} from "#phases/moody-coordinator-choice-phase";
import { MoodyCoordinatorEchoCleanupPhase, MoodyCoordinatorEchoPhase } from "#phases/moody-coordinator-echo-phase";
import { MoodyFormationChoicePhase } from "#phases/moody-formation-choice-phase";
import { MoodyRuntimeChoicePhase } from "#phases/moody-runtime-choice-phase";
import { MoodySectionReportPhase } from "#phases/moody-section-report-phase";
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
import { SelectFunModePhase } from "#phases/select-fun-mode-phase";
import { SelectGenderPhase } from "#phases/select-gender-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { SelectMoodyBoonPhase } from "#phases/select-moody-boon-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { SelectTargetPhase } from "#phases/select-target-phase";
import { ShiftSummonPhase } from "#phases/shift-summon-phase";
import { ShinySparklePhase } from "#phases/shiny-sparkle-phase";
import { ShowAbilityPhase } from "#phases/show-ability-phase";
import { ShowMoodyEffectPhase } from "#phases/show-moody-effect-phase";
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
  ErGreaterMoveRandomizerPhase,
  ErClosedCircuitBurstPhase,
  ErOmniformTransformWaitPhase,
  ErShatteredPsycheBonusPhase,
  ErSignatureFollowupPhase,
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
  CoopReplayLearnMoveBatchPhase,
  CoopGuestCatchFullPhase,
  CoopGuestColosseumChoicePhase,
  CoopGuestFaintSwitchPhase,
  CoopGuestRevivalPhase,
  CoopPartnerSyncPhase,
  CoopPresentationReceiptPhase,
  CoopInertPhase,
  CoopPushReplacementCheckpointPhase,
  CoopTurnCommitPhase,
  CoopWaveProgressionReplayPhase,
  CoopApplyResyncPhase,
  CoopAppearanceReplayPhase,
  CoopCaptureReplayPhase,
  CoopCommonAnimReplayPhase,
  CoopFinalizeEntryPresentationPhase,
  CoopFinalizeTurnPhase,
  CoopFaintReplayPhase,
  CoopFormChangeCutsceneReplayPhase,
  CoopFormChangeReplayPhase,
  CoopHideAbilityReplayPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
  CoopShowAbilityReplayPhase,
  CoopShinySparkleReplayPhase,
  CoopStatStageReplayPhase,
  CoopStatusReplayPhase,
  CoopSwitchReplayPhase,
  CoopTeraReplayPhase,
  CoopTransformReplayPhase,
  CoopVictorySealPhase,
  CommonAnimPhase,
  DamageAnimPhase,
  DynamicPhaseMarker,
  EggHatchPhase,
  EggLapsePhase,
  EggSummaryPhase,
  EncounterPhase,
  EndCardPhase,
  EndlessContinuationPhase,
  EndlessOfferPhase,
  EndlessRiftPulsePhase,
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
  MoodyFormationChoicePhase,
  MoodyCoordinatorChoicePhase,
  MoodyCoordinatorConfirmPhase,
  MoodyCoordinatorOperationPhase,
  MoodyCoordinatorPokemonChoicePhase,
  MoodyCoordinatorEchoCleanupPhase,
  MoodyCoordinatorEchoPhase,
  MoodySectionReportPhase,
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
  SelectFunModePhase,
  SelectGenderPhase,
  SelectModifierPhase,
  SelectMoodyBoonPhase,
  MoodyRuntimeChoicePhase,
  SelectStarterPhase,
  SelectTargetPhase,
  ShiftSummonPhase,
  ShinySparklePhase,
  ShowAbilityPhase,
  ShowMoodyEffectPhase,
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
  /** A suspended predecessor may finish asynchronously, but may not displace the modal above it. */
  private completedStandbyPhase: Phase | null = null;
  /**
   * Exact phase objects that crossed the scheduler's one production/test start seam.
   *
   * Ordinary temporary overrides restore an already-running standby phase and must not restart it. An
   * Authority V2 modal can instead be installed over a successor that was deliberately selected but kept
   * unstarted until its ordered result arrived. The object identity, rather than its phase name, distinguishes
   * those two cases when the modal closes.
   */
  private readonly startedPhases = new WeakSet<Phase>();
  /**
   * Runtime-owned authoritative-mutation leases, keyed by the exact phase object that acquired them.
   * A phase remains live across awaits, UI interruption, and modal overrides, so its token is released only
   * when that object actually leaves the scheduler (never merely because its synchronous start head returned).
   */
  private readonly coopMutationTokens = new WeakMap<Phase, CoopMutationToken>();
  /** The exact runtime ledger bound to this scene; never inferred from an ambient process selector. */
  private coopMutationLedger: CoopMutationLedger | null = null;
  /** An authoritative runtime must never run a phase while its scene/ledger binding is absent. */
  private coopMutationLedgerRequired = false;
  /**
   * Terminal fence for a co-op runtime that is retaining its peer-ACKed shutdown transaction. The current
   * phase may receive late async completions while that handshake runs; blocking `shiftPhase` prevents
   * those completions from rebuilding a turn after the gameplay queues were drained.
   */
  private coopTerminalProgressionFrozen = false;
  /**
   * Authority V2 recovery owns the current frontier while its correlated snapshot transaction is held.
   * The predicate is injected by the co-op runtime so this engine-level queue owner stays cycle-free.
   */
  private coopRecoveryProgressionFrozen: () => boolean = () => false;
  /** One synchronous, consumed-on-first-shift permit for the recovery transaction's exact stated control. */
  private coopRecoveryControlShiftPermitted = false;

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
      if (phase instanceof CommonAnimPhase && phase.phaseName === "CommonAnimPhase") {
        phase.recordCoopPresentationAtEnqueue();
      }
      if (phase instanceof PokemonAnimPhase && phase.phaseName === "PokemonAnimPhase") {
        phase.recordCoopPresentationAtEnqueue();
      }
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
      if (phase instanceof CommonAnimPhase && phase.phaseName === "CommonAnimPhase") {
        phase.recordCoopPresentationAtEnqueue();
      }
      if (phase instanceof PokemonAnimPhase && phase.phaseName === "PokemonAnimPhase") {
        phase.recordCoopPresentationAtEnqueue();
      }
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
    if (this.standbyPhase != null) {
      this.settleCoopMutationPhase(this.standbyPhase);
      this.standbyPhase.retire();
    }
    this.standbyPhase = null;
    this.completedStandbyPhase = null;
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

  /** Install or clear the cycle-free Authority V2 recovery progression fence. */
  public setCoopRecoveryProgressionFence(predicate: (() => boolean) | null): void {
    this.coopRecoveryProgressionFrozen = predicate ?? (() => false);
    this.coopRecoveryControlShiftPermitted = false;
  }

  /** Bind this scene directly to its runtime-owned mutation ledger. Null is valid only outside authority. */
  public setCoopMutationLedger(ledger: CoopMutationLedger | null, required = false): void {
    if (required && ledger == null) {
      throw new Error("authoritative co-op requires a scene-bound mutation ledger");
    }
    this.coopMutationLedger = ledger;
    this.coopMutationLedgerRequired = required;
  }

  /**
   * End the parked recovery phase and permit exactly its first synchronous shift to the authority-stated
   * control. The permit is consumed before that control starts, so a phase that immediately ends cannot
   * cascade into a second locally-derived phase while the recovery fence remains held.
   */
  public releaseCoopRecoveryControlPhase(release: () => void): boolean {
    if (!this.coopRecoveryProgressionFrozen() || this.coopRecoveryControlShiftPermitted) {
      return false;
    }
    this.coopRecoveryControlShiftPermitted = true;
    try {
      release();
      return !this.coopRecoveryControlShiftPermitted;
    } finally {
      this.coopRecoveryControlShiftPermitted = false;
    }
  }

  /**
   * Atomically replace an obsolete local frontier with the one recovery phase. The prior phase may still
   * receive late async completions, but {@linkcode shiftPhase} ignores them while the injected fence is held.
   */
  public replaceWithCoopRecoveryPhase(phase: Phase): boolean {
    if (!phase.is("CoopApplyResyncPhase") || !this.coopRecoveryProgressionFrozen()) {
      return false;
    }
    this.settleCoopMutationPhase(this.currentPhase);
    this.currentPhase.retire();
    this.clearAllPhases();
    this.currentPhase = phase;
    this.startCurrentPhase();
    return true;
  }

  /**
   * Atomically replace an obsolete local phase tree with an authenticated Authority V2 successor.
   *
   * Unlike {@linkcode overridePhase}, this is not a temporary modal: the predecessor and every locally
   * inferred queued/standby successor are discarded. Calling `predecessor.end()` here would let legacy
   * progression choose another phase after the ordered log already chose `successor`.
   */
  public replaceWithCoopAuthoritativePhase(predecessor: Phase, successor: Phase): boolean {
    if (
      this.currentPhase !== predecessor
      || this.coopTerminalProgressionFrozen
      || this.coopRecoveryProgressionFrozen()
    ) {
      return false;
    }
    this.settleCoopMutationPhase(predecessor);
    predecessor.retire();
    this.clearAllPhases();
    this.currentPhase = successor;
    this.startCurrentPhase();
    return true;
  }

  /**
   * Install an authenticated Authority V2 modal over its exact live predecessor.
   *
   * Replica battle replay can already occupy the generic one-level override slot while its
   * ordered finalizer is current. A later interaction commit must not be refused merely because
   * that slot still contains an obsolete local CommandPhase. Replace that stale standby with the
   * exact current predecessor, then run the committed modal. When the modal ends it returns to the
   * same parked V2 boundary; it can never resurrect the superseded local phase tree.
   */
  public replaceWithCoopAuthoritativeModal(predecessor: Phase, successor: Phase): boolean {
    if (
      this.currentPhase !== predecessor
      || this.coopTerminalProgressionFrozen
      || this.coopRecoveryProgressionFrozen()
    ) {
      return false;
    }
    if (this.standbyPhase != null && this.standbyPhase !== predecessor) {
      this.settleCoopMutationPhase(this.standbyPhase);
      this.standbyPhase.retire();
    }
    this.standbyPhase = predecessor;
    this.completedStandbyPhase = null;
    this.currentPhase = successor;
    this.startCurrentPhase();
    return true;
  }

  /**
   * Close a committed Authority V2 modal without restoring its obsolete predecessor.
   *
   * A projected nested interaction is installed over the live local shell by
   * {@linkcode replaceWithCoopAuthoritativeModal}. Cancellation legitimately returns to that shell, but a
   * committed result consumes it. Ordinary {@linkcode shiftPhase} would restore `standbyPhase` and stop there,
   * leaving the old reward/menu phase current forever while the ordered successor waits behind it.
   *
   * This is the modal counterpart of {@linkcode shiftPhaseThroughCoopAuthorityCommit}: retire both the exact
   * result phase and its parked predecessor, select the already-queued successor, retain/prove the immutable
   * result, and only then start that successor. No caller can use this as a general queue-clearing escape hatch;
   * both the current modal and a parked predecessor must exist.
   */
  public shiftCoopAuthoritativeModalThroughAuthorityCommit(phase: Phase, commitAfterClose: () => boolean): boolean {
    if (
      this.currentPhase !== phase
      || this.standbyPhase == null
      || this.coopTerminalProgressionFrozen
      || this.coopRecoveryProgressionFrozen()
    ) {
      return false;
    }

    const predecessor = this.standbyPhase;
    this.standbyPhase = null;
    this.completedStandbyPhase = null;
    this.settleCoopMutationPhase(phase);
    phase.retire();
    this.settleCoopMutationPhase(predecessor);
    predecessor.retire();

    let nextPhase = this.phaseQueue.getNextPhase();
    if (nextPhase?.is("DynamicPhaseMarker")) {
      nextPhase = this.dynamicQueueManager.popNextPhase(nextPhase.phaseType);
    }
    if (nextPhase == null) {
      this.turnStart();
    } else {
      this.currentPhase = nextPhase;
    }
    if (!commitAfterClose()) {
      return false;
    }
    this.startCurrentPhase();
    return true;
  }

  /**
   * Determine the next phase to run and start it.
   * @privateRemarks
   * This is called by {@linkcode Phase.end} by default, and should not be called by other methods.
   */
  public shiftPhase(completingPhase?: Phase): void {
    // An asynchronous presentation callback can resolve after Authority V2 has installed a modal over that
    // exact phase. Its completion belongs to the suspended predecessor; it must be remembered for the modal's
    // eventual return edge, but it may never shift the current modal or restore itself underneath the UI.
    if (completingPhase != null && completingPhase !== this.currentPhase) {
      if (completingPhase === this.standbyPhase) {
        this.completedStandbyPhase = completingPhase;
      }
      return;
    }
    if (this.coopTerminalProgressionFrozen) {
      return;
    }
    if (this.coopRecoveryProgressionFrozen()) {
      if (!this.coopRecoveryControlShiftPermitted) {
        return;
      }
      this.coopRecoveryControlShiftPermitted = false;
    }
    this.settleCoopMutationPhase(this.currentPhase);
    if (this.standbyPhase) {
      const standby = this.standbyPhase;
      this.standbyPhase = null;
      if (this.completedStandbyPhase !== standby) {
        this.completedStandbyPhase = null;
        this.currentPhase = standby;
        return;
      }
      // The predecessor already reached its natural terminal while suspended. Consume that deferred shift
      // now instead of resurrecting a dead replay with the modal's PARTY/menu handler still on screen.
      this.completedStandbyPhase = null;
      this.settleCoopMutationPhase(standby);
      standby.retire();
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
   * Close one exact authority-owned phase, retain its ordered result, and only then start the successor.
   *
   * Ordinary {@linkcode shiftPhase} starts the next phase synchronously. An interaction result that needs
   * terminal proof would therefore have to choose between proving too early or letting a locally queued
   * successor open before its immutable Authority V2 entry exists. This seam separates those two scheduler
   * edges without exposing the phase tree: `commitAfterClose` runs after `phase` is no longer current, but
   * before a newly dequeued successor starts. Returning false leaves that successor unstarted so the shared
   * terminal path can fail closed. A parked standby is restored without restarting an ordinary predecessor,
   * while an Authority V2 successor that was deliberately parked before its first start begins only after the
   * commit succeeds. The commit may atomically replace and start the selected successor (for example, by
   * projecting a buffered V2 modal). In that case this method must not start the replacement a second time.
   */
  public shiftPhaseThroughCoopAuthorityCommit(phase: Phase, commitAfterClose: () => boolean): boolean {
    if (this.currentPhase !== phase || this.coopTerminalProgressionFrozen || this.coopRecoveryProgressionFrozen()) {
      return false;
    }
    this.settleCoopMutationPhase(phase);
    if (this.standbyPhase) {
      const selectedSuccessor = this.standbyPhase;
      const standbyCompleted = this.completedStandbyPhase === selectedSuccessor;
      this.standbyPhase = null;
      this.completedStandbyPhase = null;
      if (standbyCompleted) {
        this.settleCoopMutationPhase(selectedSuccessor);
        selectedSuccessor.retire();
        let nextPhase = this.phaseQueue.getNextPhase();
        if (nextPhase?.is("DynamicPhaseMarker")) {
          nextPhase = this.dynamicQueueManager.popNextPhase(nextPhase.phaseType);
        }
        if (nextPhase == null) {
          this.turnStart();
        } else {
          this.currentPhase = nextPhase;
        }
      } else {
        this.currentPhase = selectedSuccessor;
      }
      const selectedAfterClose = this.currentPhase;
      const successorWasStarted = this.startedPhases.has(selectedAfterClose);
      const startSelectedSuccessor = commitAfterClose();
      if (this.currentPhase !== selectedAfterClose) {
        return true;
      }
      if (!startSelectedSuccessor) {
        return false;
      }
      if (!successorWasStarted) {
        this.startCurrentPhase();
      }
      return true;
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
    const selectedSuccessor = this.currentPhase;
    const startSelectedSuccessor = commitAfterClose();
    if (this.currentPhase !== selectedSuccessor) {
      return true;
    }
    if (!startSelectedSuccessor) {
      return false;
    }
    this.startCurrentPhase();
    return true;
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
    this.prepareCurrentPhaseForStart();
    this.currentPhase.start();
  }

  /**
   * Acquire the exact current phase's mutation lease immediately before its first start.
   *
   * Public only because the headless PhaseInterceptor deliberately replaces {@linkcode startCurrentPhase}
   * and must cross the same production boundary before invoking `phase.start()`. Duplicate starts of one
   * object keep one lease. The commit sentinel is the reader of this barrier and therefore never acquires a
   * token for itself.
   */
  public prepareCurrentPhaseForStart(): void {
    const phase = this.currentPhase;
    if (phase != null) {
      this.startedPhases.add(phase);
    }
    if (phase == null || phase.is("CoopTurnCommitPhase") || this.coopMutationTokens.has(phase)) {
      return;
    }
    const ledger = this.coopMutationLedger;
    if (ledger == null) {
      if (this.coopMutationLedgerRequired) {
        throw new Error(`authoritative co-op phase ${phase.phaseName} has no scene-bound mutation ledger`);
      }
      return;
    }
    this.coopMutationTokens.set(phase, ledger.begin(`phase:${phase.phaseName}`));
  }

  private settleCoopMutationPhase(phase: Phase | null | undefined): void {
    if (phase == null) {
      return;
    }
    const token = this.coopMutationTokens.get(phase);
    if (token == null) {
      return;
    }
    this.coopMutationTokens.delete(phase);
    token.settle();
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
    this.completedStandbyPhase = null;
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
    // Direct Mystery narration is already an authoritative presentation stream at the terminal
    // `ui.showText` / `ui.showDialogue` render site. Recording that same queued MessagePhase into the
    // ordinary battle-turn ledger claims a second mechanical presentation event that no renderer should
    // replay: the guest has already rendered the dedicated ME carrier. A spawned ME battle is different;
    // once handoff starts its narration belongs to the normal turn stream again.
    const directMysteryNarration = globalScene.gameMode.isCoop && coopMeInProgress() && !coopMeHandoffBattleStarted();
    if (isCoopRecording() && !directMysteryNarration) {
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
   * @param passiveSlot - When `passive` is `true`, which passive-source index is
   *   being displayed. Slots 0-2 are ER innates; later indexes are shared GIFT
   *   sources. Defaults to slot 0 for legacy callers. Ignored when `passive` is
   *   `false` or `show` is `false` (hide doesn't read the slot).
   */
  public queueAbilityDisplay(
    pokemon: Pokemon,
    passive: boolean,
    show: boolean,
    passiveSlot = 0,
    resolvedAbilityId?: AbilityId,
  ): void {
    // In ordinary solo play, disabling banners must remove their scheduling cost,
    // not merely hide the tween after hundreds of Show/Hide phases were queued.
    // Networked modes retain phases because those are ordered replay boundaries.
    if (!globalScene.showAbilityFlyouts && !globalScene.gameMode.isCoop && !globalScene.gameMode.isShowdown) {
      if (show) {
        pokemon.revealAbility(passive, passiveSlot, resolvedAbilityId);
      }
      return;
    }
    this.unshiftPhase(
      show ? new ShowAbilityPhase(pokemon.getBattlerIndex(), passive, passiveSlot) : new HideAbilityPhase(),
    );
  }

  /** Queue one trainer-owned Moody effect through the normal ability-bar presentation lane. */
  public queueMoodyEffectDisplay(cue: ConstructorParameters<typeof ShowMoodyEffectPhase>[0]): void {
    if (!globalScene.showMoodyEffectFlyouts) {
      return;
    }
    this.unshiftPhase(new ShowMoodyEffectPhase(cue), new HideAbilityPhase());
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
    // Async authority renderers can resume after the in-process two-browser scheduler installed their peer.
    // Bind them at the factory boundary, where this manager is the definitive phase-tree owner. Production
    // still has one manager/browser; this makes that existing ownership explicit without changing queue order.
    if (created instanceof CoopReplayTurnPhase) {
      created.bindOwnerPhaseManager(this);
    }
    if (
      created instanceof CoopAppearanceReplayPhase
      || created instanceof CoopFormChangeReplayPhase
      || created instanceof CoopFormChangeCutsceneReplayPhase
      || created instanceof CoopTransformReplayPhase
    ) {
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
  public queueDeferred<const T extends "ShowdownEnemyFaintSwitchPhase" | "SwitchPhase" | "SwitchSummonPhase">(
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

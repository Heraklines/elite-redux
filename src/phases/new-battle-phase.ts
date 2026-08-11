import { globalScene } from "#app/global-scene";
import type { CoopAuthorityEntryKind, CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { getCoopBiomeTransitionTailPermit } from "#data/elite-redux/coop/coop-renderer-gate";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  isAuthoritativeBattleSession,
  retryCoopV2PendingAuthorityAtSafeBoundary,
} from "#data/elite-redux/coop/coop-runtime";
import {
  beginCoopTransitionRecording,
  releaseCoopTransitionPresentation,
} from "#data/elite-redux/coop/coop-turn-recorder";
import { erGauntletActive, erGauntletWaveKind } from "#data/elite-redux/er-mystery-gauntlet";
import { startMoodyFormationBattle } from "#data/elite-redux/moody/moody-formation-game-adapter";
import { notifyMoodyRuntimeBiomeTransition } from "#data/elite-redux/moody/moody-runtime-field-engine";
import { shouldMoodyCoordinatorForceElitePursuit } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { BattleType } from "#enums/battle-type";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { BattlePhase } from "#phases/battle-phase";
import { installErCustomTrainerForCurrentWave } from "#phases/er-custom-trainer-install";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { clampAuthoredTeam } from "#system/llm-director/authored-team";
import { logBiomeSwitch, logTrainerNarrationApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { installAuthoredTeam } from "#system/llm-director/install-authored-team";
import { paginate } from "#system/llm-director/text-pagination";
import { trainerConfigs } from "#trainers/trainer-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export interface ErGauntletBargainQueue {
  removeAllPhasesOfType(name: "NextEncounterPhase" | "NewBiomeEncounterPhase"): void;
  pushNew(name: "TheBargainPhase" | "NewBattlePhase"): unknown;
}

export interface CoopCommittedBiomeEncounterQueue {
  getQueuedPhaseNames(): string[];
  removeAllPhasesOfType(name: "NextEncounterPhase"): void;
  pushNew(name: "NewBiomeEncounterPhase"): unknown;
}

export interface CoopProjectedEncounterPresentationQueue {
  pushNew(name: "ShowTrainerPhase", coopProjectedPresentation: true): unknown;
  pushNew(name: "NextEncounterPhase" | "NewBiomeEncounterPhase"): unknown;
}

/**
 * Install the guest's immutable destination presentation in the same visible order as the authority.
 * ShowTrainerPhase is presentation-only on the renderer; the following encounter phase still owns all
 * enemy adoption and field readiness. Keeping the ordering in one helper makes the positive trainer cue
 * independently testable without granting the guest any mechanical ReturnPhase authority.
 */
export function queueCoopProjectedEncounterPresentationTail(
  queue: CoopProjectedEncounterPresentationQueue,
  params: { readonly entersCommittedBiome: boolean; readonly showPlayerTrainer: boolean },
): void {
  if (params.showPlayerTrainer) {
    queue.pushNew("ShowTrainerPhase", true);
  }
  queue.pushNew(params.entersCommittedBiome ? "NewBiomeEncounterPhase" : "NextEncounterPhase");
}

interface CoopCommittedBiomeEncounterPermit {
  readonly sessionEpoch: number;
  readonly wave: number;
  readonly destinationBiomeId: number;
  readonly nextWave: number;
  readonly switchAdopted: boolean;
  readonly historyRecorded: boolean;
  readonly switchPrepared: boolean;
  readonly encounterAdopted: boolean;
}

/**
 * Normalize the host's ordinary NewBattle tail from the exact committed biome permit.
 *
 * The renderer's signed-carrier path already makes this choice explicitly. The authority instead reaches
 * ordinary `newBattle()`, whose mutable `isNewBiome()` probe can occasionally queue NextEncounter even
 * after the committed Switch tail prepared the destination. In that schedule no NewBiome phase consumes
 * the permit and a later World Map pick is rejected forever. The permit is the ordered V2 fact: it may
 * replace exactly one ordinary encounter tail only at its adjacent source/destination battle address.
 */
export function routeCoopCommittedBiomeEncounterTail(params: {
  readonly queue: CoopCommittedBiomeEncounterQueue;
  readonly permit: CoopCommittedBiomeEncounterPermit;
  readonly sessionEpoch: number;
  readonly sourceWave: number;
  readonly destinationWave: number;
  readonly destinationBiomeId: number;
}): boolean {
  const { permit } = params;
  if (
    permit.sessionEpoch !== params.sessionEpoch
    || !permit.switchAdopted
    || !permit.historyRecorded
    || !permit.switchPrepared
    || permit.encounterAdopted
    || permit.wave !== params.sourceWave
    || permit.nextWave !== params.destinationWave
    || permit.nextWave !== permit.wave + 1
    || permit.destinationBiomeId !== params.destinationBiomeId
  ) {
    return false;
  }
  const queued = params.queue.getQueuedPhaseNames();
  const newBiomeCount = queued.filter(name => name === "NewBiomeEncounterPhase").length;
  const nextEncounterCount = queued.filter(name => name === "NextEncounterPhase").length;
  if (newBiomeCount === 1 && nextEncounterCount === 0) {
    return true;
  }
  if (newBiomeCount !== 0 || nextEncounterCount !== 1) {
    return false;
  }
  params.queue.removeAllPhasesOfType("NextEncounterPhase");
  params.queue.pushNew("NewBiomeEncounterPhase");
  return true;
}

/**
 * Exact ordered wait installed by a terminal Authority V2 interaction.
 *
 * This is renderer-local structural authority, not a second network message: every field comes from the
 * committed AWAIT_SUCCESSOR that explicitly permits wave N+1 to start. The following CONTROL_COMMIT or
 * non-battle INTERACTION_COMMIT still owns creation and mutation of the destination battle.
 */
export interface CoopV2NextWaveAwaitPermit {
  readonly afterOperationId: string;
  readonly epoch: number;
  readonly wave: number;
  readonly turn: number;
}

interface CoopV2NextWaveCommandClaim {
  readonly sessionEpoch: number;
  readonly revision: number;
  readonly kind: CoopAuthorityEntryKind;
  readonly operationId: string;
  readonly nextControl: CoopNextControl;
  readonly commandOpenMaterial?: {
    readonly wave: number;
    readonly turn: number;
    readonly stateTick: number;
    readonly entryPresentation: readonly unknown[];
  };
  readonly interactionStateMaterial?: {
    readonly wave: number;
    readonly turn: number;
    readonly stateTick: number;
  };
  readonly replacementOpenMaterial?: {
    readonly origin: "settled-wave" | "pre-encounter" | "turn-resolve";
    readonly wave: number;
    readonly turn: number;
    readonly stateTick: number;
  };
  readonly replacementStateMaterial?: {
    readonly wave: number;
    readonly turn: number;
    readonly stateTick: number;
  };
}

/** Replace the synthetic Bargain wave's ordinary encounter tail with one durable phase. */
export function queueErGauntletBargainTransition(
  queue: ErGauntletBargainQueue,
  wave: number,
  active = erGauntletActive(),
): boolean {
  if (!active || erGauntletWaveKind(wave) !== "bargain") {
    return false;
  }
  queue.removeAllPhasesOfType("NextEncounterPhase");
  queue.removeAllPhasesOfType("NewBiomeEncounterPhase");
  queue.pushNew("TheBargainPhase");
  queue.pushNew("NewBattlePhase");
  return true;
}

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  private readonly coopV2Await: CoopV2NextWaveAwaitPermit | null;
  private coopV2Generation = -1;
  private coopV2DestinationBattleCreated = false;

  /** The host's ordinary N -> N+1 construction must obey the same signed biome tail as the renderer. */
  private routeCommittedHostBiomeEncounter(sourceWave: number): boolean {
    const controller = getCoopController();
    if (controller?.role !== "host" || controller.netcodeMode !== "authoritative") {
      return true;
    }
    const permit = getCoopBiomeTransitionTailPermit();
    if (permit == null || permit.wave !== sourceWave) {
      return true;
    }
    const destinationWave = globalScene.currentBattle?.waveIndex ?? -1;
    const destinationBiomeId = globalScene.arena?.biomeId ?? -1;
    const routed = routeCoopCommittedBiomeEncounterTail({
      queue: globalScene.phaseManager,
      permit,
      sessionEpoch: controller.sessionEpoch,
      sourceWave,
      destinationWave,
      destinationBiomeId,
    });
    if (!routed) {
      coopWarn(
        "v2-control",
        `NewBattlePhase could not install committed biome encounter tail wave=${sourceWave}->${destinationWave} `
          + `biome=${destinationBiomeId} permit=${permit.operationId}`,
      );
      failCoopSharedSession(
        `The shared biome transition could not install its exact encounter at wave ${destinationWave}.`,
      );
      return false;
    }
    coopLog(
      "v2-control",
      `NewBattlePhase installed committed host biome encounter wave=${sourceWave}->${destinationWave}`,
    );
    return true;
  }

  constructor(coopV2Await: CoopV2NextWaveAwaitPermit | null = null) {
    super();
    this.coopV2Await = coopV2Await;
  }

  /**
   * Prove that the next mechanical entry is the exact N+1/t1 successor of this signed ordered wait.
   * Merely reaching NewBattlePhase is never enough: the phase remains parked until this address-exact claim
   * is admitted by the global V2 log. A pre-encounter replacement is a first-class successor because a
   * surviving party can enter the new wave with an empty field slot. Its complete replacement-open control
   * may create the signed destination shell; the consecutive REPLACEMENT_COMMIT must render the chosen
   * state before the encounter. Neither entry grants a generic phase permission to advance the wave.
   */
  public canReleaseForCoopV2Control(successor: CoopV2NextWaveCommandClaim): boolean {
    const wait = this.coopV2Await;
    const command = successor.nextControl;
    const commandMaterial = successor.commandOpenMaterial;
    const replacementOpenMaterial = successor.replacementOpenMaterial;
    const replacementMaterial = successor.replacementStateMaterial;
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    const exactCommand =
      successor.kind === "CONTROL_COMMIT"
      && command.kind === "COMMAND_FRONTIER"
      && commandMaterial != null
      && command.epoch === successor.sessionEpoch
      && command.wave === commandMaterial.wave
      && command.turn === commandMaterial.turn
      && Array.isArray(commandMaterial.entryPresentation);
    const exactPreEncounterReplacement =
      successor.kind === "REPLACEMENT_COMMIT"
      && command.kind === "AWAIT_SUCCESSOR"
      && replacementMaterial != null
      && command.afterOperationId === successor.operationId
      && command.epoch === successor.sessionEpoch
      && command.wave === replacementMaterial.wave
      && command.turn === replacementMaterial.turn
      && replacementMaterial.stateTick > 0
      && command.allowedKinds.includes("CONTROL_COMMIT");
    const exactPreEncounterReplacementOpen =
      successor.kind === "CONTROL_COMMIT"
      && command.kind === "REPLACEMENT"
      && replacementOpenMaterial?.origin === "pre-encounter"
      && command.epoch === successor.sessionEpoch
      && command.wave === replacementOpenMaterial.wave
      && command.turn === replacementOpenMaterial.turn
      && replacementOpenMaterial.stateTick > 0;
    const destinationWave = commandMaterial?.wave ?? replacementOpenMaterial?.wave ?? replacementMaterial?.wave;
    const destinationTurn = commandMaterial?.turn ?? replacementOpenMaterial?.turn ?? replacementMaterial?.turn;
    return (
      wait != null
      && this.coopV2Generation >= 0
      && coopSessionGeneration() === this.coopV2Generation
      && globalScene.phaseManager.getCurrentPhase() === this
      && successor.sessionEpoch === wait.epoch
      && successor.sessionEpoch === getCoopController()?.sessionEpoch
      && successor.operationId.length > 0
      && (exactCommand || exactPreEncounterReplacementOpen || exactPreEncounterReplacement)
      && destinationWave === wait.wave + 1
      && destinationTurn === 1
      && (ambientWave === wait.wave || ambientWave === destinationWave)
    );
  }

  /** Build only the Battle identity required for the signed mechanical image; no encounter tail is inferred. */
  public prepareForCoopV2ControlMaterial(successor: CoopV2NextWaveCommandClaim): boolean {
    if (!this.canReleaseForCoopV2Control(successor)) {
      return false;
    }
    const wait = this.coopV2Await;
    const destinationWave =
      successor.commandOpenMaterial?.wave
      ?? successor.replacementOpenMaterial?.wave
      ?? successor.replacementStateMaterial?.wave;
    const destinationTurn =
      successor.commandOpenMaterial?.turn
      ?? successor.replacementOpenMaterial?.turn
      ?? successor.replacementStateMaterial?.turn;
    const currentBattle = globalScene.currentBattle;
    if (wait == null || destinationWave == null || destinationTurn == null || currentBattle == null) {
      return false;
    }
    if (currentBattle.waveIndex === destinationWave) {
      const alreadyPrepared = currentBattle.turn === destinationTurn;
      this.coopV2DestinationBattleCreated ||= alreadyPrepared;
      return alreadyPrepared;
    }
    if (
      this.coopV2DestinationBattleCreated
      || currentBattle.waveIndex !== wait.wave
      || destinationWave !== currentBattle.waveIndex + 1
      || destinationTurn !== 1
    ) {
      return false;
    }
    try {
      const destinationBattle = globalScene.newCoopV2ProjectedBattle();
      if (
        globalScene.currentBattle !== destinationBattle
        || destinationBattle.waveIndex !== destinationWave
        || destinationBattle.turn !== destinationTurn
      ) {
        throw new Error(
          `destination Battle address mismatch expected=${destinationWave}:${destinationTurn} `
            + `actual=${destinationBattle.waveIndex}:${destinationBattle.turn}`,
        );
      }
      this.coopV2DestinationBattleCreated = true;
      coopLog(
        "v2-control",
        `NewBattlePhase prepared signed destination shell wave=${wait.wave}->${destinationBattle.waveIndex} `
          + `after=${wait.afterOperationId}`,
      );
      return true;
    } catch (error) {
      coopWarn("v2-control", "NewBattlePhase could not prepare its signed destination Battle shell", error);
      failCoopSharedSession(`The shared interaction could not create battle wave ${destinationWave}.`);
      return false;
    }
  }

  /** Prove that a non-battle interaction is the exact first authoritative surface of wave N+1. */
  public canPrepareForCoopV2InteractionMaterial(successor: CoopV2NextWaveCommandClaim): boolean {
    const wait = this.coopV2Await;
    const control = successor.nextControl;
    const material = successor.interactionStateMaterial;
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    return (
      wait != null
      && this.coopV2Generation >= 0
      && coopSessionGeneration() === this.coopV2Generation
      && globalScene.phaseManager.getCurrentPhase() === this
      && successor.sessionEpoch === wait.epoch
      && successor.sessionEpoch === getCoopController()?.sessionEpoch
      && successor.kind === "INTERACTION_COMMIT"
      && successor.operationId.length > 0
      && control.kind === "SHARED_INTERACTION"
      && control.operationId === successor.operationId
      && material != null
      && control.epoch === successor.sessionEpoch
      && control.wave === material.wave
      && control.turn === material.turn
      && material.wave === wait.wave + 1
      && material.stateTick > 0
      && (ambientWave === wait.wave || ambientWave === material.wave)
    );
  }

  /** Build only the destination Battle identity; the interaction entry applies every mechanical field. */
  public prepareForCoopV2InteractionMaterial(successor: CoopV2NextWaveCommandClaim): boolean {
    if (!this.canPrepareForCoopV2InteractionMaterial(successor)) {
      return false;
    }
    const wait = this.coopV2Await;
    const material = successor.interactionStateMaterial;
    const currentBattle = globalScene.currentBattle;
    if (wait == null || material == null || currentBattle == null) {
      return false;
    }
    if (currentBattle.waveIndex === material.wave) {
      this.coopV2DestinationBattleCreated = true;
      return true;
    }
    if (
      this.coopV2DestinationBattleCreated
      || currentBattle.waveIndex !== wait.wave
      || material.wave !== currentBattle.waveIndex + 1
    ) {
      return false;
    }
    try {
      const destinationBattle = globalScene.newCoopV2ProjectedBattle();
      if (globalScene.currentBattle !== destinationBattle || destinationBattle.waveIndex !== material.wave) {
        throw new Error(
          `interaction destination Battle address mismatch expectedWave=${material.wave} `
            + `actual=${destinationBattle.waveIndex}`,
        );
      }
      this.coopV2DestinationBattleCreated = true;
      coopLog(
        "v2-interaction",
        `NewBattlePhase prepared signed interaction shell wave=${wait.wave}->${destinationBattle.waveIndex} `
          + `after=${wait.afterOperationId}`,
      );
      return true;
    } catch (error) {
      coopWarn("v2-interaction", "NewBattlePhase could not prepare its signed interaction Battle shell", error);
      failCoopSharedSession(`The shared interaction could not create battle wave ${material.wave}.`);
      return false;
    }
  }

  /** Retain a remote-owned picker bridge until DATA arrives; expose a local-owned picker after material install. */
  private releaseCoopV2PreEncounterReplacementOpen(successor: CoopV2NextWaveCommandClaim): boolean | null {
    if (successor.kind !== "CONTROL_COMMIT" || successor.replacementOpenMaterial == null) {
      return null;
    }
    const material = successor.replacementOpenMaterial;
    const command = successor.nextControl;
    if (
      material.origin !== "pre-encounter"
      || command.kind !== "REPLACEMENT"
      || globalScene.currentBattle?.waveIndex !== material.wave
      || globalScene.currentBattle.turn !== material.turn
    ) {
      return false;
    }
    coopLog("v2-replacement", `NewBattlePhase consumed signed pre-encounter replacement-open wave=${material.wave}`);
    if (getCoopController()?.localSeatId !== command.ownerSeatId) {
      // The remote owner's control is installed without a local PARTY surface. Retain this structural
      // bridge until the consecutive REPLACEMENT_COMMIT supplies the immutable answer; ending it now
      // would let an empty queue derive TurnInit while the authority is still waiting for that player.
      return true;
    }
    this.end();
    return globalScene.phaseManager.getCurrentPhase() !== this;
  }

  /** Release only after the signed N+1 carrier has either installed DATA or retained its replay transaction. */
  public releaseForCoopV2Control(successor: CoopV2NextWaveCommandClaim): boolean {
    if (!this.canReleaseForCoopV2Control(successor)) {
      return false;
    }
    const command = successor.nextControl;
    const replacementOpenRelease = this.releaseCoopV2PreEncounterReplacementOpen(successor);
    if (replacementOpenRelease != null) {
      return replacementOpenRelease;
    }
    if (successor.kind === "REPLACEMENT_COMMIT") {
      const material = successor.replacementStateMaterial;
      if (
        material == null
        || command.kind !== "AWAIT_SUCCESSOR"
        || !this.prepareForCoopV2ControlMaterial(successor)
        || globalScene.currentBattle?.waveIndex !== material.wave
        || globalScene.currentBattle.turn !== material.turn
      ) {
        return false;
      }
      coopLog(
        "v2-replacement",
        `NewBattlePhase routed signed pre-encounter replacement wave=${material.wave} before encounter`,
      );
      globalScene.phaseManager.unshiftNew(
        "CoopReplayTurnPhase",
        material.turn,
        0,
        undefined,
        material.wave,
        false,
        undefined,
        "next-encounter",
      );
      this.end();
      return globalScene.phaseManager.getCurrentPhase() !== this;
    }
    if (
      command.kind !== "COMMAND_FRONTIER"
      || globalScene.currentBattle?.waveIndex !== command.wave
      || globalScene.currentBattle.turn !== command.turn
    ) {
      return false;
    }
    coopLog("v2-control", `NewBattlePhase consumed signed destination carrier wave=${command.wave}`);
    // A guest-owned natural World Map pick can finish its SwitchBiomePhase before the retained N+1 command
    // carrier reaches this signed NewBattlePhase. The old unconditional NextEncounter tail then skipped the
    // exact NewBiome presentation and, more importantly, left its fully prepared one-shot permit alive. The
    // next BIOME_PICK could not arm a different permit and remained material-deferred forever (god-c wave
    // 160 -> 170). Select the encounter tail from the immutable, scene-local permit only after command DATA
    // installed the exact destination; no local biome inference or RNG is involved.
    const biomePermit = getCoopBiomeTransitionTailPermit();
    const entersCommittedBiome =
      biomePermit != null
      && biomePermit.sessionEpoch === successor.sessionEpoch
      && biomePermit.switchAdopted
      && biomePermit.historyRecorded
      && biomePermit.switchPrepared
      && !biomePermit.encounterAdopted
      && biomePermit.nextWave === command.wave
      && biomePermit.destinationBiomeId === globalScene.arena.biomeId;
    const destinationBattle = globalScene.currentBattle;
    if (destinationBattle == null) {
      return false;
    }
    const resetsArenaPresentation =
      entersCommittedBiome
      || destinationBattle.isClassicFinalBoss
      || destinationBattle.battleType === BattleType.TRAINER
      || destinationBattle.battleType === BattleType.MYSTERY_ENCOUNTER;
    queueCoopProjectedEncounterPresentationTail(globalScene.phaseManager, {
      entersCommittedBiome,
      showPlayerTrainer: resetsArenaPresentation && !globalScene.trainer.visible,
    });
    this.end();
    return globalScene.phaseManager.getCurrentPhase() !== this;
  }

  start() {
    if (this.coopV2Await != null) {
      if (!isCoopAuthoritativeGuestGated()) {
        failCoopSharedSession("A signed next-wave wait opened outside the authoritative renderer.");
        return;
      }
      this.coopV2Generation = coopSessionGeneration();
      super.start();
      globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");
      const battle = globalScene.currentBattle;
      if (
        battle == null
        || getCoopController()?.sessionEpoch !== this.coopV2Await.epoch
        || (battle.waveIndex !== this.coopV2Await.wave && battle.waveIndex !== this.coopV2Await.wave + 1)
      ) {
        failCoopSharedSession(
          `The signed next-wave wait lost its source address ${this.coopV2Await.wave}:${this.coopV2Await.turn}.`,
        );
        return;
      }
      coopLog(
        "v2-control",
        `NewBattlePhase parked for signed destination carrier wave=${this.coopV2Await.wave}->${
          this.coopV2Await.wave + 1
        }`,
      );
      retryCoopV2PendingAuthorityAtSafeBoundary();
      return;
    }
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    const sourceWave = globalScene.currentBattle?.waveIndex ?? -1;
    const controller = getCoopController();
    if (sourceWave >= 0 && isAuthoritativeBattleSession() && controller?.role === "host") {
      // `newBattle()` advances currentBattle before it narrates expiring arena tags. If the prior battle
      // enters a non-battle Mystery surface, that surface has no replay pump or command frontier. Open a
      // deferred destination prefix first: real battles release it below, while adjacent Mystery surfaces
      // carry it until the next signed command can durably own every cue. InitEncounter/Summon/TurnStart
      // use this same scope and preserve it.
      beginCoopTransitionRecording(1, `${controller.sessionEpoch}:${sourceWave + 1}`);
    }
    globalScene.newBattle();
    notifyMoodyRuntimeBiomeTransition();
    startMoodyFormationBattle();

    if (!this.routeCommittedHostBiomeEncounter(sourceWave)) {
      return;
    }

    if (this.routeMysteryGauntletBargain()) {
      this.end();
      return;
    }

    // Elite Redux: staff-authored custom trainers (er-custom-trainers.json).
    // Runs after newBattle() has built the wave but before EncounterPhase's
    // genPartyMember, so we can convert the wave into the authored trainer.
    installErCustomTrainerForCurrentWave();
    const moodyWave = globalScene.currentBattle?.waveIndex ?? 0;
    if (
      globalScene.currentBattle?.battleType === BattleType.WILD
      && shouldMoodyCoordinatorForceElitePursuit(moodyWave, globalScene.gameMode.isBoss(moodyWave))
    ) {
      this.convertWildToTrainer(moodyWave, undefined);
    }

    // After newBattle has populated the upcoming wave's enemy levels, consume
    // any pending LLM Director inter-beat override for that wave. v1 applies
    // levelDelta directly to enemy levels; speciesSwaps are deferred to v2
    // since they need deeper hooks into trainer party generation.
    if (globalScene.gameMode.modeId === GameModes.LLM_DIRECTOR) {
      this.applyPendingDirectorOverride();
      // NewBattlePhase fires when transitioning between waves (wave 2 onward).
      // The first beat (wave 1 intro) is fired by BiblePhase via the queue;
      // here we fire on every 3rd wave (3, 6, 9, …).
      const wave = globalScene.currentBattle?.waveIndex ?? 0;

      // Act-boundary biome switch: if this wave is the start of a new act
      // in the bible, switch to the act's designated biome so the location
      // matches the story.
      this.applyActBiomeSwitch(wave);

      const isBeatWave = wave > 0 && wave % 3 === 0;
      console.info(
        `[llm-director] NewBattlePhase wave=${wave}, isBeatWave=${isBeatWave}, mode=${globalScene.gameMode.modeId}`,
      );
      if (isBeatWave) {
        console.info(`[llm-director] Unshifting LLMDirectorBeatPhase for wave ${wave}`);
        globalScene.phaseManager.unshiftNew("LLMDirectorBeatPhase", wave);
      }
    }

    if (controller?.role === "host" && globalScene.currentBattle?.battleType !== BattleType.MYSTERY_ENCOUNTER) {
      // Real battle entry has a retained CONTROL_COMMIT consumer. Non-battle Mystery surfaces deliberately
      // keep cleanup narration deferred so the next adjacent battle can carry it instead of emitting an
      // unconsumable best-effort packet at the selector wave.
      releaseCoopTransitionPresentation();
    }

    this.end();
  }

  private routeMysteryGauntletBargain(): boolean {
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    if (!queueErGauntletBargainTransition(globalScene.phaseManager, wave)) {
      return false;
    }
    console.log(`[er-gauntlet] wave=${wave} kind=bargain -> TheBargainPhase -> wave ${wave + 1}`);
    return true;
  }

  /**
   * If `wave` is the start (waveStart) of a story bible act, switch to that
   * act's designated biome AND fire a bible-refinement pass in the
   * background so the next act's beats benefit from a re-read of the
   * run-so-far. Refinement is opportunistic — it doesn't block the act
   * transition, and falls back to the original bible silently on failure.
   * Keeps the visual location in sync with the narrative — a smuggler's-
   * den arc plays in a CAVE, a court drama in a TEMPLE, etc. No-op if
   * the bible isn't loaded or the wave isn't a boundary.
   */
  private applyActBiomeSwitch(wave: number): void {
    const state = globalScene.gameData.llmDirectorState;
    const bible = state?.storyBible;
    if (!bible || wave <= 0) {
      return;
    }
    const act = bible.acts.find(a => a.waveStart === wave);
    if (!act) {
      return;
    }
    // Fire a refinement pass in the background. Don't await; the next
    // beat envelope picks up the refined bible if it lands in time.
    const runtime = getDirectorRuntime();
    if (runtime && state) {
      void import("#system/llm-director/refine-story-bible").then(({ refineStoryBible }) =>
        refineStoryBible(runtime.client, { bible, state })
          .then(refined => {
            if (refined) {
              state.storyBible = refined;
              console.info(`[llm-director] bible refined at act boundary wave=${wave} act=${act.name}`);
            }
          })
          .catch(err => {
            console.warn(
              `[llm-director] bible refinement crashed wave=${wave}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
      );
    }
    if (typeof act.biomeId !== "number") {
      return;
    }
    const currentBiome = globalScene.arena?.biomeId;
    if (currentBiome === act.biomeId) {
      return;
    }
    logBiomeSwitch(`act-boundary-wave-${wave}`, currentBiome, act.biomeId, act.name);
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", act.biomeId as BiomeId);
  }

  private applyPendingDirectorOverride(): void {
    const runtime = getDirectorRuntime();
    if (!runtime) {
      return;
    }
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    const override = runtime.queue.takeInterBeatOverride(battle.waveIndex);
    if (!override) {
      return;
    }
    // ── BATTLE-TYPE OVERRIDES (priority order) ──────────────────────────
    // Each override below can transform what the upcoming wave actually IS:
    //   forceMysteryEncounter   wave -> MYSTERY_ENCOUNTER (vanilla pool)
    //   wildEncounter           wave -> WILD with LLM-specified Pokemon
    //   trainerOverride.enemyTeam   wave -> TRAINER with LLM-authored team
    //   trainerOverride.trainerType  wave -> TRAINER with LLM-specified sprite
    // Higher priority transforms run first; lower-priority transforms only
    // apply if the higher-priority ones didn't fire.
    if (override.forceMysteryEncounter) {
      this.applyForceMysteryEncounter(battle.waveIndex);
    } else if (override.wildEncounter && override.wildEncounter.pokemon.length > 0) {
      this.applyWildEncounterOverride(battle.waveIndex, override.wildEncounter);
    } else {
      // Trainer override path. Two sub-cases:
      //  (a) wave was already TRAINER, requested type differs → swap sprite
      //  (b) wave was WILD but the LLM emitted trainerType OR enemyTeam →
      //      convert WILD→TRAINER so the narration matches the actual fight.
      // (b) is critical: without it, the LLM writes "a Grass Kingdom ranger
      // blocks the path" but the player faces a random wild Sentret because
      // vanilla rolled WILD that wave and we only set trainerType which is
      // a no-op for non-trainer waves.
      const trOver = override.trainerOverride;
      const wantsTrainer =
        !!trOver
        && (typeof trOver.trainerType === "number" || (Array.isArray(trOver.enemyTeam) && trOver.enemyTeam.length > 0));
      if (wantsTrainer && battle.battleType === BattleType.WILD) {
        this.convertWildToTrainer(battle.waveIndex, trOver.trainerType);
      }
      const requestedTrainerType = trOver?.trainerType;
      const hasEnemyTeam = !!(trOver?.enemyTeam && trOver.enemyTeam.length > 0);
      if (
        typeof requestedTrainerType === "number"
        && battle.battleType === BattleType.TRAINER
        && battle.trainer
        && requestedTrainerType !== battle.trainer.config.trainerType
      ) {
        this.applyTrainerTypeOverride(battle.waveIndex, requestedTrainerType, hasEnemyTeam);
      }
    }
    // Mid-act biome switch: orthogonal to battle-type — just queue the
    // SwitchBiomePhase before EncounterPhase runs. The new biome is in
    // place by the time the wave actually plays.
    if (override.biomeChange && typeof override.biomeChange.biomeId === "number") {
      const targetBiome = override.biomeChange.biomeId as BiomeId;
      const currentBiome = globalScene.arena?.biomeId;
      if (currentBiome !== targetBiome) {
        logBiomeSwitch(`override-wave-${battle.waveIndex}`, currentBiome, targetBiome);
        globalScene.phaseManager.unshiftNew("SwitchBiomePhase", targetBiome);
      }
    }
    // LLM-authored trainer team. Skipped if a higher-priority override
    // already transformed the wave (forceMysteryEncounter / wildEncounter)
    // — those replace the entire battle setup, so a trainer-team override
    // would be moot. Still applies levelDelta in the no-team case.
    const enemyTeam = override.trainerOverride?.enemyTeam;
    const isTransformedToWildOrME =
      override.forceMysteryEncounter || (override.wildEncounter && override.wildEncounter.pokemon.length > 0);
    if (!isTransformedToWildOrME) {
      if (enemyTeam && enemyTeam.length > 0 && battle.battleType === BattleType.TRAINER) {
        this.applyAuthoredEnemyTeam(battle.waveIndex, enemyTeam, override.trainerOverride?.levelDelta);
      } else {
        const snapshot = { enemyLevels: battle.enemyLevels };
        const applied = applyOverrideToBattle(snapshot, override);
        if (applied && snapshot.enemyLevels) {
          battle.enemyLevels = snapshot.enemyLevels;
        }
      }
    }
    const swapCount = override.trainerOverride?.speciesSwaps?.length ?? 0;
    if (swapCount > 0 && (!enemyTeam || enemyTeam.length === 0)) {
      // legacy v1 swap path is superseded by enemyTeam in v2; only log when
      // the LLM emitted swaps without a full team.
      console.info(
        `[llm-director] interBeatOverride.speciesSwaps received for wave ${battle.waveIndex} (deferred to v2)`,
      );
    }
    // Story-themed pre-battle line: queue the LLM-written narration for
    // this wave so the trainer encounter feels part of the run's story
    // instead of a vanilla wave with canned trainer-class dialogue.
    if (override.preBattleText) {
      // For trainer waves: REPLACE the canonical "I challenge you!" line
      // with the LLM's preBattleText via the per-instance
      // encounterMessagesOverride. The standard EncounterPhase flow then
      // shows our text with the trainer's name as speaker, character
      // sprite if any, and proper timing (after the trainer slides in,
      // before the first Pokemon summons). No separate MessagePhase.
      //
      // For wild waves and mystery encounters: queue a MessagePhase as
      // before (no trainer instance to attach the override to).
      if (battle.battleType === BattleType.TRAINER && battle.trainer) {
        // Paginate so the in-battle dialog respects the 2-line cap.
        battle.trainer.encounterMessagesOverride = [paginate(override.preBattleText)];
      } else {
        void globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.phaseManager.queueMessage(paginate(override.preBattleText), null, true);
      }
      logTrainerNarrationApplied(battle.waveIndex, override.preBattleText);
    }
    // Trainer name override: best-effort cosmetic so the trainer is
    // displayed as "Concordat Ranger Vance" instead of "Ranger Joe".
    if (override.trainerName && battle.trainer) {
      battle.trainer.name = override.trainerName;
    }
    // Stash the post-battle slice so VictoryPhase / FaintPhase can fire
    // narration + rewards + effects after the battle resolves. Only set the
    // hook if at least one field is non-empty; an empty hook is wasted memory.
    const hasPostHook =
      !!override.postWinText
      || !!override.postLossText
      || (override.victoryRewards && override.victoryRewards.length > 0)
      || (override.victoryEffects && override.victoryEffects.length > 0)
      || (override.defeatEffects && override.defeatEffects.length > 0);
    if (hasPostHook) {
      const hook: import("#system/llm-director/director-queue").PostBattleHook = {};
      if (override.postWinText) {
        hook.postWinText = override.postWinText;
      }
      if (override.postLossText) {
        hook.postLossText = override.postLossText;
      }
      if (override.victoryRewards && override.victoryRewards.length > 0) {
        hook.victoryRewards = override.victoryRewards;
      }
      if (override.victoryEffects && override.victoryEffects.length > 0) {
        hook.victoryEffects = override.victoryEffects;
      }
      if (override.defeatEffects && override.defeatEffects.length > 0) {
        hook.defeatEffects = override.defeatEffects;
      }
      runtime.queue.setPostBattleHook(battle.waveIndex, hook);
      console.info(
        `[llm-director] post-wave-hook stashed wave=${battle.waveIndex} (postWinText=${!!override.postWinText} postLossText=${!!override.postLossText} rewards=${override.victoryRewards?.length ?? 0} victoryEffects=${override.victoryEffects?.length ?? 0} defeatEffects=${override.defeatEffects?.length ?? 0})`,
      );
    }
  }

  /**
   * Replace the current battle's trainer with one of the LLM-requested type.
   *
   * `globalScene.newBattle()` (called at the top of NewBattlePhase) has
   * already created a Trainer of the wave-curve-rolled trainerType, added
   * it to `globalScene.field`, and stored it on `battle.trainer`. By the
   * time this runs, the old trainer is fully constructed but its sprite
   * assets haven't been loaded yet — that happens later in EncounterPhase
   * via `battle.trainer?.loadAssets().then(initSprite)`. So we can swap
   * the trainer instance cleanly here and EncounterPhase will load assets
   * for the new one.
   *
   * Refuses to swap to:
   *   - id 0 (UNKNOWN sentinel)
   *   - id >= 200 (named gym leaders / elite four / champions / rivals;
   *     these have fixed canonical teams and special UI handling that
   *     would break if hijacked by the LLM)
   *   - unknown trainerConfigs entries
   * Skips silently if the requested type matches the existing trainer.
   *
   * Variant is preserved from the original (DEFAULT / FEMALE / DOUBLE);
   * the Trainer constructor falls back to DEFAULT if the new config
   * doesn't support the requested variant.
   */
  /**
   * Convert a WILD wave to a TRAINER wave by spawning a Trainer instance
   * from scratch. Used when the LLM's preBattleText narration implies a
   * trainer fight (named NPC, faction-tagged opponent) but vanilla rolled
   * WILD for this wave and there's no existing trainer to swap.
   *
   * If `requestedType` is provided and valid, uses it. Otherwise picks a
   * neutral fallback (BACKPACKER) so the narration still gets a
   * matching-ish sprite. The caller's subsequent installAuthoredTeam
   * step (when enemyTeam is set) will populate the team; otherwise the
   * trainer's vanilla party templates run.
   */
  private convertWildToTrainer(waveIndex: number, requestedType: number | undefined): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    let chosenType: TrainerType = TrainerType.BACKPACKER;
    if (typeof requestedType === "number" && requestedType > TrainerType.UNKNOWN && requestedType < 200) {
      const cfg = trainerConfigs[requestedType as TrainerType];
      if (cfg && !cfg.doubleOnly) {
        chosenType = requestedType as TrainerType;
      }
    }
    try {
      const variant = TrainerVariant.DEFAULT;
      const newTrainer = new Trainer(chosenType, variant);
      globalScene.field.add(newTrainer);
      battle.trainer = newTrainer;
      battle.battleType = BattleType.TRAINER;
      // Wipe any wild Pokemon that vanilla pre-loaded so EncounterPhase
      // generates the trainer party fresh via genPartyMember.
      battle.enemyParty = [];
      // Trainer parties typically use the wave-curve-derived enemyLevels;
      // keep whatever vanilla set, just truncate to single-battle size.
      const baseLevel = battle.enemyLevels?.[0] ?? Math.max(5, waveIndex);
      battle.enemyLevels = [baseLevel];
      battle.setDouble(false);
      console.info(
        `[llm-director] wild-to-trainer conversion wave=${waveIndex} chosenType=${chosenType} (LLM requested type=${requestedType ?? "none"})`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-director] wild-to-trainer conversion failed wave=${waveIndex} reason=${reason}`);
    }
  }

  private applyTrainerTypeOverride(waveIndex: number, requestedType: number, hasEnemyTeam: boolean): void {
    const battle = globalScene.currentBattle;
    if (!battle?.trainer) {
      return;
    }
    if (requestedType <= TrainerType.UNKNOWN) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: id=${requestedType} is the UNKNOWN sentinel`,
      );
      return;
    }
    // Named trainers (id >= 200, gym leaders / E4 / champions / rivals)
    // have fixed canonical teams that are usually dramatically scaled
    // for endgame. Refuse the swap when the LLM didn't provide enemyTeam
    // (otherwise wave 5 would face a champion's level-60 lineup). With
    // enemyTeam, installAuthoredTeam overwrites the canonical party so
    // only the SPRITE is borrowed — perfect for "the rival's apprentice"
    // / "a champion-style ace appears" / etc.
    if (requestedType >= 200 && !hasEnemyTeam) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: named-trainer id=${requestedType} requires trainerOverride.enemyTeam (canonical team would otherwise surface). Sprite reuse for named trainers is allowed, but the LLM must spec the team.`,
      );
      return;
    }
    const newConfig = trainerConfigs[requestedType as TrainerType];
    if (!newConfig) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: no trainerConfig for id=${requestedType}`,
      );
      return;
    }
    const oldTrainer = battle.trainer;
    const oldVariant = oldTrainer.variant;
    // If the original was DOUBLE and the new config doesn't support double,
    // fall back to DEFAULT — Trainer's constructor handles this internally,
    // but we surface it to the log so behavior is debuggable.
    let chosenVariant = oldVariant;
    if (oldVariant === TrainerVariant.DOUBLE && !newConfig.hasDouble && !newConfig.doubleOnly) {
      chosenVariant = TrainerVariant.DEFAULT;
    }
    if (oldVariant === TrainerVariant.FEMALE && !newConfig.hasGenders) {
      chosenVariant = TrainerVariant.DEFAULT;
    }
    if (newConfig.doubleOnly && oldVariant !== TrainerVariant.DOUBLE) {
      // newConfig requires double but battle isn't set up for it — refuse,
      // because changing battle.double mid-construction would cascade into
      // FieldPosition / SummonPhase logic we don't want to mess with.
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: id=${requestedType} is double-only but battle is single`,
      );
      return;
    }
    try {
      const newTrainer = new Trainer(requestedType as TrainerType, chosenVariant);
      // If the original had a custom display name, preserve it on the new
      // instance so the LLM's `trainerName` override (applied later in this
      // method) stays consistent.
      if (oldTrainer.name) {
        newTrainer.name = oldTrainer.name;
      }
      // Detach old trainer from the field and destroy its Phaser resources.
      // destroy() walks parent containers and removes itself; explicit
      // remove() first is belt-and-braces in case the trainer was added to
      // a custom container at any point.
      globalScene.field.remove(oldTrainer, false);
      oldTrainer.destroy();
      // Wire the new trainer in. EncounterPhase will load its sprite assets
      // when it runs `battle.trainer?.loadAssets().then(initSprite)`.
      globalScene.field.add(newTrainer);
      battle.trainer = newTrainer;
      console.info(
        `[llm-director] trainer-type-override applied wave=${waveIndex} oldType=${oldTrainer.config.trainerType} newType=${requestedType} variant=${chosenVariant}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-director] trainer-type-override failed wave=${waveIndex} reason=${reason}`);
    }
  }

  /**
   * Convert the wave to a WILD encounter populated with the LLM-specified
   * Pokemon. If the wave was originally TRAINER, the trainer is destroyed
   * first. The enemyParty is pre-populated so EncounterPhase reuses it
   * (skipping its own `globalScene.randomSpecies` roll — see the
   * `!battle.enemyParty[e]` guard added in encounter-phase.ts).
   *
   * Up to 2 Pokemon (single or double battle). Each entry's level defaults
   * to the wave-curve baseline; abilityIndex / moveIds / nickname / shiny
   * are honored when valid; held items granted via consequence.effects
   * paths instead (we don't apply heldItemKeys for wild encounters since
   * vanilla wild Pokemon don't carry held items by default).
   */
  private applyWildEncounterOverride(
    waveIndex: number,
    spec: { pokemon: import("#data/llm-director/beat-schema").AuthoredPokemon[]; isBoss?: boolean },
  ): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    // Tear down the trainer if there was one.
    if (battle.battleType === BattleType.TRAINER && battle.trainer) {
      try {
        globalScene.field.remove(battle.trainer, false);
        battle.trainer.destroy();
      } catch (err) {
        console.warn(
          `[llm-director] wild-encounter-override wave=${waveIndex} trainer-destroy warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      battle.trainer = null;
    }
    battle.battleType = BattleType.WILD;
    const baseLevel = battle.enemyLevels?.[0] ?? Math.max(5, waveIndex);
    const finalLevels: number[] = [];
    battle.enemyParty = [];
    for (let i = 0; i < spec.pokemon.length && i < 2; i++) {
      const p = spec.pokemon[i];
      const species = getPokemonSpecies(p.speciesId);
      if (!species) {
        console.warn(`[llm-director] wild-encounter-override wave=${waveIndex} unknown speciesId=${p.speciesId}`);
        continue;
      }
      const level = Math.max(1, Math.floor(p.level ?? baseLevel));
      const isBoss = !!p.isBoss || !!spec.isBoss;
      try {
        const enemy = globalScene.addEnemyPokemon(species, level, TrainerSlot.NONE, isBoss);
        if (Array.isArray(p.moveIds) && p.moveIds.length > 0) {
          enemy.moveset = p.moveIds.slice(0, 4).map(id => new PokemonMove(id));
        }
        // AuthoredPokemon uses `abilityId` (the Ability enum value); the
        // EnemyPokemon's `abilityIndex` is the slot (0=ability1, 1=ability2,
        // 2=hidden) into its species. Map by matching the requested ability.
        if (typeof p.abilityId === "number" && p.abilityId >= 0) {
          const slot =
            species.ability1 === p.abilityId
              ? 0
              : species.ability2 === p.abilityId
                ? 1
                : species.abilityHidden === p.abilityId
                  ? 2
                  : -1;
          if (slot >= 0) {
            enemy.abilityIndex = slot;
          }
        }
        if (p.shiny) {
          enemy.shiny = true;
        }
        battle.enemyParty.push(enemy);
        finalLevels.push(level);
      } catch (err) {
        console.warn(
          `[llm-director] wild-encounter-override wave=${waveIndex} addEnemyPokemon failed for speciesId=${p.speciesId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    battle.enemyLevels = finalLevels;
    battle.setDouble(battle.enemyParty.length > 1);
    console.info(
      `[llm-director] wild-encounter-override applied wave=${waveIndex} count=${battle.enemyParty.length} levels=[${finalLevels.join(",")}] boss=${!!spec.isBoss}`,
    );
  }

  /**
   * Convert the wave to a vanilla MYSTERY_ENCOUNTER. PokeRogue's existing
   * `EncounterPhase` then runs the standard mystery-encounter pipeline:
   * picks an eligible encounter from the biome pool, sets up sprites, and
   * queues `MysteryEncounterPhase` for the option-select UI. This gives
   * the LLM an "I want a vanilla mystery event here" lever, alongside the
   * LLM-authored dialogue beats.
   */
  private applyForceMysteryEncounter(waveIndex: number): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    if (battle.battleType === BattleType.TRAINER && battle.trainer) {
      try {
        globalScene.field.remove(battle.trainer, false);
        battle.trainer.destroy();
      } catch (err) {
        console.warn(
          `[llm-director] force-mystery-encounter wave=${waveIndex} trainer-destroy warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      battle.trainer = null;
    }
    battle.battleType = BattleType.MYSTERY_ENCOUNTER;
    // Leave battle.mysteryEncounter undefined so EncounterPhase fills it
    // from the vanilla pool (`globalScene.getMysteryEncounter(undefined)`
    // rolls by tier weight against the biome's eligible list).
    battle.mysteryEncounter = undefined;
    battle.mysteryEncounterType = MysteryEncounterType.MYSTERIOUS_CHEST;
    console.info(`[llm-director] force-mystery-encounter applied wave=${waveIndex} (vanilla pool roll)`);
  }

  /**
   * Apply an LLM-authored team for an upcoming trainer wave. Server-side
   * balance rails clamp levels/team-size/moveset, then `installAuthoredTeam`
   * mutates the live trainer config so EncounterPhase emits the authored
   * party. On any failure (bad species id, invalid move, etc.) we log and
   * leave the vanilla generation in place — the run never breaks.
   */
  private applyAuthoredEnemyTeam(
    waveIndex: number,
    team: import("#data/llm-director/beat-schema").AuthoredPokemon[],
    levelDelta: number | undefined,
  ): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    const baseLevel = battle.enemyLevels?.[0] ?? 5;
    const adjustedBase = baseLevel + (levelDelta ?? 0);
    try {
      const clamped = clampAuthoredTeam(team, {
        baseLevel: adjustedBase,
        recentFaints: 0,
      });
      const failure = installAuthoredTeam(battle, clamped);
      if (failure) {
        console.warn(`[llm-director] team-build-failed wave=${waveIndex} reason=${failure}`);
        return;
      }
      console.info(
        `[llm-director] authored-team-installed wave=${waveIndex} size=${clamped.length} levels=[${battle.enemyLevels?.join(",")}]`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-director] team-build-failed wave=${waveIndex} reason=${reason}`);
    }
  }
}

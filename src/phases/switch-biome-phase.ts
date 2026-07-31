import { globalScene } from "#app/global-scene";
import type { CoopAuthorityEntryKind, CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { captureCoopAuthoritativeBattleState, captureCoopEnemies } from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_WAVE_NO_ME } from "#data/elite-redux/coop/coop-battle-stream";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  adoptCoopBiomeTransitionSwitchPermit,
  finalizeCoopBiomeTransitionAfterRetainedBattlePermit,
  getCoopBiomeTransitionTailPermit,
  markCoopBiomeTransitionHistoryRecorded,
  markCoopBiomeTransitionSwitchPrepared,
} from "#data/elite-redux/coop/coop-renderer-gate";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopController,
  retryCoopV2PendingAuthorityAtSafeBoundary,
} from "#data/elite-redux/coop/coop-runtime";
import {
  type ErRouteNode,
  erBiomeRoutingActive,
  erRecordBiomeEntry,
  getErPrevBiome,
  markErPendingNodesAwaitingAuthority,
  rollErNextBiomeNodes,
  setErPendingNodes,
} from "#data/elite-redux/er-biome-routing";
import {
  type ErBiomeStructurePlan,
  erRollBiomeLength,
  planErBiomeStructure,
  restoreErBiomeStructure,
} from "#data/elite-redux/er-biome-structure";
import { clearErBiomeNodes, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import type { BiomeId } from "#enums/biome-id";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import { BattlePhase } from "#phases/battle-phase";
import { captureCoopEncounterAuthority } from "#phases/encounter-phase";
import { getBiomeName } from "#utils/common";

interface CoopV2BiomeCommandSuccessorClaim {
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
}

export class SwitchBiomePhase extends BattlePhase {
  public readonly phaseName = "SwitchBiomePhase";
  private readonly nextBiome: BiomeId;
  /** Immutable source boundary captured by SelectBiome before speculative NewBattle state can advance. */
  private readonly coopSourceWave: number | null;
  /** A V2 result projected this tail destructively; only its destination command carrier may release it. */
  private readonly coopAwaitDestinationCarrier: boolean;
  private coopPermitRecoveryShown = false;
  private coopPermitRecoveryAttempts = 0;
  private historyRecorded = false;
  private switchPrepared = false;
  private ended = false;
  private coopGeneration = -1;
  private coopWave = -1;
  private coopAuthoritativeGuest = false;
  private coopPreparationPlan: {
    readonly nodes: readonly ErRouteNode[];
    readonly visibleNodes: readonly { biome: BiomeId; label: string; kind: "biome" }[];
    readonly structure: ErBiomeStructurePlan;
  } | null = null;
  private coopMapCleared = false;
  private coopRoutesApplied = false;
  private coopRevealsApplied = false;
  private coopStructureApplied = false;
  /** True after the exact destination CONTROL_COMMIT authorized creation of its Battle shell. */
  private coopDestinationBattleCreated = false;
  /** Exact permit whose duplicate NewBattle tail was removed after retained authority advanced already. */
  private coopRetainedBattlePermit: {
    readonly operationId: string;
    readonly destinationBiomeId: number;
    readonly nextWave: number;
  } | null = null;

  /**
   * A destructively projected BIOME_PICK has no speculative NewBattlePhase behind it. The exact next
   * CONTROL_COMMIT must therefore use this live transition as its DATA consumer, then release it only after
   * the complete destination battle image is installed. Without this bridge an empty phase queue falls
   * through to TurnInit on the completed source battle and parks the renderer in CoopReplayTurnPhase.
   */
  public canReleaseForCoopV2Control(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    const permit = getCoopBiomeTransitionTailPermit();
    const command = successor.nextControl;
    const material = successor.commandOpenMaterial;
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    return (
      this.coopGeneration >= 0
      && this.coopAwaitDestinationCarrier
      && coopSessionGeneration() === this.coopGeneration
      && globalScene.phaseManager.getCurrentPhase() === this
      && successor.sessionEpoch === getCoopController()?.sessionEpoch
      && successor.kind === "CONTROL_COMMIT"
      && successor.operationId.length > 0
      && command?.kind === "COMMAND_FRONTIER"
      && material != null
      && command.epoch === successor.sessionEpoch
      && command.wave === material.wave
      && command.turn === material.turn
      && command.turn === 1
      && Array.isArray(material.entryPresentation)
      && permit != null
      && permit.switchAdopted
      && permit.destinationBiomeId === this.nextBiome
      && permit.wave === (this.coopSourceWave ?? this.coopWave)
      && permit.nextWave === command.wave
      && (ambientWave === permit.wave || ambientWave === permit.nextWave)
    );
  }

  /**
   * Materialize the destination Battle shell authorized by this exact command-open entry.
   *
   * A destructively projected BIOME_PICK intentionally has no speculative NewBattlePhase behind it. The
   * authoritative state applier reconciles party/field/arena material but does not replace Battle identity,
   * so applying wave N+1 DATA while the scene still owns wave N leaves every later control proof impossible.
   * This hook substitutes only that missing structural NewBattle step. It runs after address-exact V2
   * admission and before DATA, and it cannot choose a wave or successor: the retained permit and signed
   * turn-one frontier must both name the immediately following battle.
   */
  public prepareForCoopV2ControlMaterial(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    if (!this.canReleaseForCoopV2Control(successor)) {
      return false;
    }
    const command = successor.nextControl;
    const permit = getCoopBiomeTransitionTailPermit();
    const currentBattle = globalScene.currentBattle;
    if (command.kind !== "COMMAND_FRONTIER" || permit == null || currentBattle == null) {
      return false;
    }
    if (currentBattle.waveIndex === command.wave) {
      const alreadyPrepared = currentBattle.turn === command.turn;
      this.coopDestinationBattleCreated ||= alreadyPrepared;
      return alreadyPrepared;
    }
    if (
      this.coopDestinationBattleCreated
      || currentBattle.waveIndex !== permit.wave
      || command.wave !== permit.nextWave
      || command.wave !== currentBattle.waveIndex + 1
      || command.turn !== 1
    ) {
      return false;
    }
    try {
      const destinationBattle = globalScene.newCoopV2ProjectedBattle();
      if (
        globalScene.currentBattle !== destinationBattle
        || destinationBattle.waveIndex !== command.wave
        || destinationBattle.turn !== command.turn
      ) {
        throw new Error(
          `destination Battle address mismatch expected=${command.wave}:${command.turn} `
            + `actual=${destinationBattle.waveIndex}:${destinationBattle.turn}`,
        );
      }
      this.coopDestinationBattleCreated = true;
      coopLog(
        "v2-control",
        `SwitchBiomePhase prepared destination Battle shell wave=${permit.wave}->${destinationBattle.waveIndex}`,
      );
      return true;
    } catch (error) {
      coopWarn("v2-control", "SwitchBiomePhase could not prepare its exact destination Battle shell", error);
      failCoopSharedSession(
        `The shared biome transition could not create its authoritative battle at wave ${command.wave}.`,
      );
      return false;
    }
  }

  /** Prove that a shared interaction is the exact first authoritative surface in the destination biome. */
  public canPrepareForCoopV2InteractionMaterial(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    const permit = getCoopBiomeTransitionTailPermit();
    const control = successor.nextControl;
    const material = successor.interactionStateMaterial;
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    return (
      this.coopGeneration >= 0
      && this.coopAwaitDestinationCarrier
      && coopSessionGeneration() === this.coopGeneration
      && globalScene.phaseManager.getCurrentPhase() === this
      && successor.sessionEpoch === getCoopController()?.sessionEpoch
      && successor.kind === "INTERACTION_COMMIT"
      && successor.operationId.length > 0
      && control.kind === "SHARED_INTERACTION"
      && control.operationId === successor.operationId
      && material != null
      && control.epoch === successor.sessionEpoch
      && control.wave === material.wave
      && control.turn === material.turn
      && material.turn === 1
      && material.stateTick > 0
      && permit != null
      && permit.switchAdopted
      && permit.destinationBiomeId === this.nextBiome
      && permit.wave === (this.coopSourceWave ?? this.coopWave)
      && permit.nextWave === material.wave
      && (ambientWave === permit.wave || ambientWave === permit.nextWave)
    );
  }

  /** Build only the destination Battle identity; the interaction entry applies every mechanical field. */
  public prepareForCoopV2InteractionMaterial(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    if (!this.canPrepareForCoopV2InteractionMaterial(successor)) {
      return false;
    }
    const material = successor.interactionStateMaterial;
    const permit = getCoopBiomeTransitionTailPermit();
    const currentBattle = globalScene.currentBattle;
    if (material == null || permit == null || currentBattle == null) {
      return false;
    }
    if (currentBattle.waveIndex === material.wave) {
      const alreadyPrepared = currentBattle.turn === material.turn;
      this.coopDestinationBattleCreated ||= alreadyPrepared;
      return alreadyPrepared;
    }
    if (
      this.coopDestinationBattleCreated
      || currentBattle.waveIndex !== permit.wave
      || material.wave !== permit.nextWave
      || material.wave !== currentBattle.waveIndex + 1
      || material.turn !== 1
    ) {
      return false;
    }
    try {
      const destinationBattle = globalScene.newCoopV2ProjectedBattle();
      if (
        globalScene.currentBattle !== destinationBattle
        || destinationBattle.waveIndex !== material.wave
        || destinationBattle.turn !== material.turn
      ) {
        throw new Error(
          `interaction destination Battle address mismatch expected=${material.wave}:${material.turn} `
            + `actual=${destinationBattle.waveIndex}:${destinationBattle.turn}`,
        );
      }
      this.coopDestinationBattleCreated = true;
      coopLog(
        "v2-interaction",
        `SwitchBiomePhase prepared destination interaction shell wave=${permit.wave}->${destinationBattle.waveIndex}`,
      );
      return true;
    } catch (error) {
      coopWarn("v2-interaction", "SwitchBiomePhase could not prepare its destination interaction shell", error);
      failCoopSharedSession(
        `The shared biome transition could not create its authoritative interaction at wave ${material.wave}.`,
      );
      return false;
    }
  }

  /**
   * Finish the signed switch after interaction DATA sealed the N+1 shell, while retaining the ordinary
   * NewBiome presentation as the only route to the committed Mystery surface.
   */
  public releaseForCoopV2InteractionMaterial(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    if (!this.canPrepareForCoopV2InteractionMaterial(successor)) {
      return false;
    }
    const material = successor.interactionStateMaterial;
    if (
      material == null
      || globalScene.currentBattle?.waveIndex !== material.wave
      || globalScene.currentBattle.turn !== material.turn
    ) {
      return false;
    }
    let permit = getCoopBiomeTransitionTailPermit();
    if (permit == null) {
      return false;
    }
    if (!permit.historyRecorded) {
      erRecordBiomeEntry(permit.sourceBiomeId as BiomeId);
      permit = markCoopBiomeTransitionHistoryRecorded(permit.operationId);
      if (permit == null) {
        return false;
      }
    }
    if (!permit.switchPrepared) {
      permit = markCoopBiomeTransitionSwitchPrepared(permit.operationId);
      if (permit == null) {
        return false;
      }
    }
    this.materializeCoopTransition();
    coopLog(
      "v2-interaction",
      `SwitchBiomePhase consumed destination interaction carrier wave=${permit.wave}->${permit.nextWave}`,
    );
    globalScene.phaseManager.unshiftNew("NewBiomeEncounterPhase");
    this.end();
    return globalScene.phaseManager.getCurrentPhase() !== this;
  }

  /**
   * Install the exact post-switch presentation phase after CONTROL_COMMIT DATA sealed the prepared N+1 shell.
   *
   * `canReleaseForCoopV2Control` deliberately does not require the permit's history/preparation stages or
   * destination arena before DATA is applied. A destructively projected biome result can leave this phase
   * parked before those renderer-local stages run; requiring them as a precondition for the only complete
   * destination carrier creates a circular wait. Once runtime DATA has installed the immutable N+1 image,
   * finish those one-shot permit stages without rolling/rebuilding any host-owned state, materialize only
   * the arena presentation, and let NewBiomeEncounter consume the exact prepared permit.
   */
  public releaseForCoopV2Control(successor: CoopV2BiomeCommandSuccessorClaim): boolean {
    if (!this.canReleaseForCoopV2Control(successor)) {
      return false;
    }
    const command = successor.nextControl;
    if (
      command.kind !== "COMMAND_FRONTIER"
      || globalScene.currentBattle?.waveIndex !== command.wave
      || globalScene.currentBattle.turn !== command.turn
    ) {
      return false;
    }
    let permit = getCoopBiomeTransitionTailPermit();
    if (permit == null) {
      return false;
    }
    if (!permit.historyRecorded) {
      erRecordBiomeEntry(permit.sourceBiomeId as BiomeId);
      permit = markCoopBiomeTransitionHistoryRecorded(permit.operationId);
      if (permit == null) {
        return false;
      }
    }
    if (!permit.switchPrepared) {
      // The CONTROL_COMMIT's authoritative state already contains the host's destination routes, reveals,
      // biome structure, party, field, and battle. Marking the exact stage here records that completed DATA
      // install; re-running guest preparation would overwrite that immutable image with empty placeholders.
      permit = markCoopBiomeTransitionSwitchPrepared(permit.operationId);
      if (permit == null) {
        return false;
      }
    }
    this.materializeCoopTransition();
    coopLog(
      "v2-control",
      `SwitchBiomePhase consumed destination command carrier wave=${permit.wave}->${permit.nextWave}`,
    );
    globalScene.phaseManager.unshiftNew("NewBiomeEncounterPhase");
    this.end();
    return globalScene.phaseManager.getCurrentPhase() !== this;
  }

  constructor(nextBiome: BiomeId, coopSourceWave: number | null = null, coopAwaitDestinationCarrier = false) {
    super();

    this.nextBiome = nextBiome;
    this.coopSourceWave =
      coopSourceWave != null && Number.isSafeInteger(coopSourceWave) && coopSourceWave >= 0 ? coopSourceWave : null;
    this.coopAwaitDestinationCarrier = coopAwaitDestinationCarrier;
  }

  start() {
    const currentlyAuthoritativeGuest = isCoopAuthoritativeGuestGated();
    const currentlyAuthoritativeCoop =
      currentlyAuthoritativeGuest
      || (globalScene.gameMode.isCoop && getCoopController()?.netcodeMode === "authoritative");
    if (currentlyAuthoritativeCoop && this.coopGeneration < 0) {
      this.coopGeneration = coopSessionGeneration();
      this.coopWave = globalScene.currentBattle?.waveIndex ?? -1;
      this.coopAuthoritativeGuest = currentlyAuthoritativeGuest;
    }
    const authoritativeCoop = this.coopGeneration >= 0 || currentlyAuthoritativeCoop;
    const authoritativeGuest = this.coopGeneration >= 0 ? this.coopAuthoritativeGuest : currentlyAuthoritativeGuest;
    // A retained recovery callback may fire after this phase was replaced, the battle advanced, or the
    // session generation changed. Reject at the public entry seam before BattlePhase.start or ANY permit,
    // history, routing, structure, or arena mutation is attempted.
    if (authoritativeCoop && !this.coopBoundaryStillLive()) {
      return;
    }
    super.start();

    if (this.nextBiome === undefined) {
      return this.end();
    }

    const sourceBiome = globalScene.arena?.biomeId ?? -1;
    const sourceWave = globalScene.currentBattle?.waveIndex ?? -1;
    const activePermit = authoritativeCoop ? getCoopBiomeTransitionTailPermit() : null;
    const replayingCommittedSwitch = activePermit?.switchAdopted === true;
    // The next battle can be mirrored before this queued presentation tail starts. Keep the permit addressed
    // to SelectBiome's immutable completed-wave boundary, but admit only the exact same or immediately-next
    // ambient battle so an obsolete queued phase cannot spend authority at an unrelated future wave.
    const permitWave =
      this.coopSourceWave != null && (sourceWave === this.coopSourceWave || sourceWave === this.coopSourceWave + 1)
        ? this.coopSourceWave
        : sourceWave;
    let permit = authoritativeCoop
      ? adoptCoopBiomeTransitionSwitchPermit({
          destinationBiomeId: this.nextBiome,
          sourceBiomeId: sourceBiome,
          wave: permitWave,
        })
      : null;
    if (authoritativeCoop && permit == null) {
      coopWarn(
        "runtime",
        `SwitchBiomePhase refused unsanctioned authoritative mutation source=${sourceBiome} destination=${this.nextBiome} ambientWave=${sourceWave} sourceWave=${permitWave}`,
      );
      this.parkForAuthoritativePermit();
      return;
    }

    if (authoritativeGuest && this.coopAwaitDestinationCarrier) {
      // A destructively projected BIOME_PICK deliberately cleared the replica's speculative NewBattle tail.
      // Preparing this renderer-only switch and ending it here would therefore empty the queue, manufacture
      // TurnInit on the completed source battle, and strand the next CONTROL_COMMIT behind CoopReplayTurnPhase.
      // Keep the exact permit + phase current until the immutable N+1 command carrier installs the complete
      // destination battle through releaseForCoopV2Control(). Retry once now in case the carrier was admitted
      // in the same delivery stack immediately before this phase became current; authority retention owns all
      // later redelivery.
      coopLog(
        "v2-control",
        `SwitchBiomePhase parked for projected destination carrier wave=${permit?.wave}->${permit?.nextWave}`,
      );
      retryCoopV2PendingAuthorityAtSafeBoundary();
      return;
    }

    // A lost callback may replay this same phase after newBattle already advanced to the permitted first
    // destination wave. The logical transition is complete; shifting the phase is the only idempotent act.
    if (
      authoritativeCoop
      && replayingCommittedSwitch
      && permit != null
      && sourceBiome === permit.destinationBiomeId
      && sourceWave === permit.nextWave
    ) {
      this.end();
      return;
    }

    if (authoritativeCoop && permit != null) {
      try {
        this.discardAlreadyMaterializedBattleAdvance(permit, sourceWave);
        this.prepareAuthoritativeTransition(authoritativeGuest, permit, sourceWave);
        this.materializeCoopTransition();
        this.republishRetainedBattleAuthority(authoritativeGuest, permit, sourceWave);
        this.end();
      } catch (error) {
        coopWarn("runtime", "SwitchBiomePhase preparation/materialization threw; exact plan remains retryable", error);
        this.parkForAuthoritativePermit();
      }
      return;
    }

    // ER (#486): record the biome we're leaving as the "previous" biome, so the
    // World Map routing graph can exclude it from the NEXT transition's options.
    // Only fires on real transitions (not run start / save load).
    if (!(permit?.historyRecorded ?? this.historyRecorded)) {
      erRecordBiomeEntry(globalScene.arena?.biomeId ?? null);
      this.historyRecorded = true;
      if (permit != null) {
        permit = markCoopBiomeTransitionHistoryRecorded(permit.operationId);
        if (permit == null) {
          this.parkForAuthoritativePermit();
          return;
        }
      }
    }

    // Roll the NEW biome's onward routes now and stash them, so (a) the map
    // overlay shows the player's routes while in this biome and (b) the leave
    // transition reuses the same set instead of re-rolling. Reveal only the
    // visible (Map-Upgrade-gated) nodes; clear the prior biome's stale routes.
    if (erBiomeRoutingActive() && !(permit?.switchPrepared ?? this.switchPrepared)) {
      clearErBiomeNodes();
      if (authoritativeGuest) {
        // A renderer never rolls the destination's route graph or biome length, including the older
        // WAVE_ADVANCE-sanctioned single-route path. Mark only the entry boundary so newBattle selects
        // NewBiomeEncounterPhase; the host's ensuing carrier atomically adopts map/routes/structure.
        markErPendingNodesAwaitingAuthority();
        restoreErBiomeStructure(null, permit?.nextWave ?? sourceWave + 1, null);
      } else {
        const nodes = rollErNextBiomeNodes(this.nextBiome, getErPrevBiome());
        setErPendingNodes(nodes);
        revealMapNodes(
          nodes
            .filter(n => n.revealed)
            .map(n => ({ biome: n.biome, label: getBiomeName(n.biome), kind: "biome" as const })),
        );

        // ER (#486): roll THIS biome's variable length + record its start wave. The
        // new biome's first battle is the wave AFTER the boundary we just cleared.
        erRollBiomeLength(this.nextBiome, (globalScene.currentBattle?.waveIndex ?? 0) + 1, globalScene.seed);
      }
    }
    if (!(permit?.switchPrepared ?? this.switchPrepared)) {
      this.switchPrepared = true;
      if (permit != null) {
        permit = markCoopBiomeTransitionSwitchPrepared(permit.operationId);
        if (permit == null) {
          this.parkForAuthoritativePermit();
          return;
        }
      }
    }

    // Before switching biomes, make sure to set the last encounter for other phases that need it too.
    globalScene.lastEnemyTrainer = globalScene.currentBattle?.trainer ?? null;
    globalScene.lastMysteryEncounter = globalScene.currentBattle?.mysteryEncounter;

    // The renderer's canonical state change is synchronous and presentation is non-gating. This removes
    // both tween callbacks from the authority path; host/solo retain the animated transition below.
    if (authoritativeCoop) {
      this.materializeCoopTransition();
      this.end();
      return;
    }

    globalScene.tweens.add({
      targets: [globalScene.arenaEnemy, globalScene.lastEnemyTrainer],
      x: "+=300",
      duration: 2000,
      onComplete: () => {
        globalScene.arenaEnemy.setX(globalScene.arenaEnemy.x - 600);

        globalScene.newArena(this.nextBiome);

        const biomeKey = getBiomeKey(this.nextBiome);
        const bgTexture = `${biomeKey}_bg`;
        globalScene.arenaBgTransition.setTexture(bgTexture);
        globalScene.arenaBgTransition.setAlpha(0);
        globalScene.arenaBgTransition.setVisible(true);
        globalScene.arenaPlayerTransition.setBiome(this.nextBiome);
        globalScene.arenaPlayerTransition.setAlpha(0);
        globalScene.arenaPlayerTransition.setVisible(true);

        globalScene.tweens.add({
          targets: [globalScene.arenaPlayer, globalScene.arenaBgTransition, globalScene.arenaPlayerTransition],
          duration: 1000,
          delay: 1000,
          ease: "Sine.easeInOut",
          alpha: (target: any) => (target === globalScene.arenaPlayer ? 0 : 1),
          onComplete: () => {
            globalScene.arenaBg.setTexture(bgTexture);
            globalScene.arenaPlayer.setBiome(this.nextBiome);
            globalScene.arenaPlayer.setAlpha(1);
            globalScene.arenaEnemy.setBiome(this.nextBiome);
            globalScene.arenaEnemy.setAlpha(1);
            globalScene.arenaNextEnemy.setBiome(this.nextBiome);
            globalScene.arenaBgTransition.setVisible(false);
            globalScene.arenaPlayerTransition.setVisible(false);
            if (globalScene.lastEnemyTrainer) {
              globalScene.lastEnemyTrainer.destroy();
            }

            this.end();
          },
        });
      },
    });
  }

  /**
   * A retained WAVE_ADVANCE can install the destination battle before this presentation tail runs. The
   * SelectBiome queue still contains the ordinary NewBattlePhase for the same boundary; executing it would
   * advance the renderer a second time (source N -> retained N+1 -> local N+2). Remove only that immediate,
   * exact duplicate. Any different queue shape fails closed so an unrelated future battle cannot be eaten.
   */
  private discardAlreadyMaterializedBattleAdvance(
    permit: NonNullable<ReturnType<typeof getCoopBiomeTransitionTailPermit>>,
    ambientWave: number,
  ): void {
    if (ambientWave !== permit.nextWave) {
      return;
    }
    const queued = globalScene.phaseManager.getQueuedPhaseNames?.() ?? [];
    const firstNewBattle = queued.indexOf("NewBattlePhase");
    if (firstNewBattle < 0) {
      return;
    }
    if (firstNewBattle !== 0 || !globalScene.phaseManager.tryRemovePhase("NewBattlePhase")) {
      throw new Error(
        `Could not discard exact duplicate NewBattlePhase for retained biome boundary ${permit.wave}->${permit.nextWave}; queue=[${queued.join(",")}]`,
      );
    }
    this.coopRetainedBattlePermit = {
      operationId: permit.operationId,
      destinationBiomeId: permit.destinationBiomeId,
      nextWave: permit.nextWave,
    };
    coopLog(
      "runtime",
      `SwitchBiomePhase discarded duplicate NewBattlePhase after retained battle advance wave=${permit.wave}->${permit.nextWave}`,
    );
  }

  private prepareAuthoritativeTransition(
    authoritativeGuest: boolean,
    initialPermit: NonNullable<ReturnType<typeof getCoopBiomeTransitionTailPermit>>,
    sourceWave: number,
  ): void {
    let permit = initialPermit;
    if (!permit.historyRecorded) {
      // The immutable result state may already have installed the destination arena before this presentation
      // tail runs. History still records the committed source, never whichever arena image happens to be live.
      erRecordBiomeEntry(permit.sourceBiomeId as BiomeId);
      permit = markCoopBiomeTransitionHistoryRecorded(permit.operationId) ?? permit;
      if (!permit.historyRecorded) {
        throw new Error("Could not record exact biome history stage");
      }
    }

    if (erBiomeRoutingActive() && !permit.switchPrepared) {
      const entryWave = permit.nextWave ?? sourceWave + 1;
      if (this.coopPreparationPlan == null) {
        this.coopPreparationPlan = this.buildAuthoritativePreparationPlan(authoritativeGuest, entryWave);
      }
      const plan = this.coopPreparationPlan;
      if (plan == null) {
        throw new Error("Biome preparation plan was not retained");
      }
      if (!this.coopMapCleared) {
        this.clearAuthoritativeMapNodes();
        this.coopMapCleared = true;
      }
      if (!this.coopRoutesApplied) {
        this.applyAuthoritativeRoutes(authoritativeGuest, plan);
        this.coopRoutesApplied = true;
      }
      if (!this.coopRevealsApplied) {
        this.applyAuthoritativeReveals(authoritativeGuest, plan);
        this.coopRevealsApplied = true;
      }
      if (!this.coopStructureApplied) {
        this.applyAuthoritativeStructure(plan);
        this.coopStructureApplied = true;
      }
    }
    if (!permit.switchPrepared) {
      permit = markCoopBiomeTransitionSwitchPrepared(permit.operationId) ?? permit;
      if (!permit.switchPrepared) {
        throw new Error("Could not finalize exact biome preparation stage");
      }
    }

    globalScene.lastEnemyTrainer = globalScene.currentBattle?.trainer ?? null;
    globalScene.lastMysteryEncounter = globalScene.currentBattle?.mysteryEncounter;
  }

  /** Narrow deterministic/fault-injection seams. Each write is idempotent; its completion bit flips only after return. */
  private buildAuthoritativePreparationPlan(
    authoritativeGuest: boolean,
    entryWave: number,
  ): NonNullable<SwitchBiomePhase["coopPreparationPlan"]> {
    if (authoritativeGuest) {
      return {
        nodes: [],
        visibleNodes: [],
        structure: { length: null, startWave: entryWave },
      };
    }
    const nodes = rollErNextBiomeNodes(this.nextBiome, getErPrevBiome(), globalScene.seed, entryWave).map(node => ({
      ...node,
    }));
    return {
      nodes,
      visibleNodes: nodes
        .filter(node => node.revealed)
        .map(node => ({ biome: node.biome, label: getBiomeName(node.biome), kind: "biome" as const })),
      structure: planErBiomeStructure(entryWave, globalScene.seed),
    };
  }

  private clearAuthoritativeMapNodes(): void {
    clearErBiomeNodes();
  }

  private applyAuthoritativeRoutes(
    authoritativeGuest: boolean,
    plan: NonNullable<SwitchBiomePhase["coopPreparationPlan"]>,
  ): void {
    if (authoritativeGuest) {
      markErPendingNodesAwaitingAuthority();
    } else {
      setErPendingNodes(plan.nodes.map(node => ({ ...node })));
    }
  }

  private applyAuthoritativeReveals(
    authoritativeGuest: boolean,
    plan: NonNullable<SwitchBiomePhase["coopPreparationPlan"]>,
  ): void {
    if (!authoritativeGuest) {
      revealMapNodes(plan.visibleNodes.map(node => ({ ...node })));
    }
  }

  private applyAuthoritativeStructure(plan: NonNullable<SwitchBiomePhase["coopPreparationPlan"]>): void {
    restoreErBiomeStructure(plan.structure.length, plan.structure.startWave, null);
  }

  private materializeCoopTransition(): void {
    if (globalScene.arena?.biomeId !== this.nextBiome) {
      globalScene.newArena(this.nextBiome);
    }
    const bgTexture = `${getBiomeKey(this.nextBiome)}_bg`;
    globalScene.arenaBg.setTexture(bgTexture);
    globalScene.arenaPlayer.setBiome(this.nextBiome);
    globalScene.arenaPlayer.setAlpha(1);
    globalScene.arenaEnemy.setBiome(this.nextBiome);
    globalScene.arenaEnemy.setAlpha(1);
    globalScene.arenaNextEnemy.setBiome(this.nextBiome);
    globalScene.arenaBgTransition.setVisible(false);
    globalScene.arenaPlayerTransition.setVisible(false);
    if (globalScene.lastEnemyTrainer) {
      globalScene.lastEnemyTrainer.destroy();
      globalScene.lastEnemyTrainer = null;
    }
  }

  /**
   * Retained WAVE_ADVANCE may install and publish the destination battle before this queued Switch tail
   * rolls the host's route graph and biome structure. Re-publish that same immutable wave carrier after the
   * plan is applied, otherwise the renderer correctly waits with empty routes and reaches Command with a
   * permanently stale `erMapState`. Ordinary source-wave ordering publishes later in EncounterPhase and is
   * therefore a no-op here.
   */
  private republishRetainedBattleAuthority(
    authoritativeGuest: boolean,
    permit: NonNullable<ReturnType<typeof getCoopBiomeTransitionTailPermit>>,
    ambientWave: number,
  ): void {
    if (authoritativeGuest || ambientWave !== permit.nextWave || getCoopController()?.role !== "host") {
      return;
    }
    const battle = globalScene.currentBattle;
    const streamer = getCoopBattleStreamer();
    if (battle == null || streamer == null || battle.waveIndex !== permit.nextWave) {
      throw new Error(`Retained biome boundary ${permit.operationId} lost its destination carrier`);
    }
    const authoritativeState = captureCoopAuthoritativeBattleState(battle.turn);
    if (authoritativeState == null) {
      throw new Error(`Retained biome boundary ${permit.operationId} could not capture post-switch state`);
    }
    streamer.sendEnemyParty(
      battle.waveIndex,
      captureCoopEnemies(),
      battle.mysteryEncounter?.encounterType ?? COOP_WAVE_NO_ME,
      battle.battleType,
      authoritativeState,
      captureCoopEncounterAuthority(battle),
    );
    coopLog("replay", `host RE-BROADCAST retained wave ${battle.waveIndex} after biome route/structure preparation`);
  }

  override end(): void {
    if (this.ended) {
      return;
    }
    const retainedBattlePermit = this.coopRetainedBattlePermit;
    try {
      super.end();
      if (retainedBattlePermit != null) {
        if (globalScene.phaseManager.getCurrentPhase() === this) {
          throw new Error(`Queue did not advance after retained biome boundary ${retainedBattlePermit.nextWave}`);
        }
        if (finalizeCoopBiomeTransitionAfterRetainedBattlePermit(retainedBattlePermit) == null) {
          throw new Error(`Could not retire retained biome permit ${retainedBattlePermit.operationId}`);
        }
        this.coopRetainedBattlePermit = null;
      }
      this.ended = true;
    } catch (error) {
      const queueAlreadyAdvanced = globalScene.phaseManager.getCurrentPhase() !== this;
      if (queueAlreadyAdvanced && retainedBattlePermit != null) {
        // shiftPhase installs the next phase before starting it. If that start threw, the old Switch phase
        // cannot retry. Retire only the exact fully prepared permit, then stop the binary session instead
        // of leaving a live client with an orphaned single-slot transition.
        finalizeCoopBiomeTransitionAfterRetainedBattlePermit(retainedBattlePermit);
        this.coopRetainedBattlePermit = null;
        this.ended = true;
        failCoopSharedSession(
          `The shared biome transition to ${this.nextBiome} installed a next phase that could not start.`,
        );
        return;
      }
      coopWarn("runtime", "SwitchBiomePhase queue shift threw; exact permit remains retryable", error);
      this.parkForAuthoritativePermit();
    }
  }

  /** Missing authority never advances the queue; reconnect/replay may arm the exact permit, then retry. */
  private parkForAuthoritativePermit(): void {
    if (this.coopPermitRecoveryShown || !this.coopBoundaryStillLive()) {
      return;
    }
    this.coopPermitRecoveryAttempts++;
    if (this.coopPermitRecoveryAttempts > 2) {
      failCoopSharedSession(
        `The shared biome transition to ${this.nextBiome} lost its exact committed permit after bounded recovery.`,
      );
      return;
    }
    this.coopPermitRecoveryShown = true;
    void globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.coopBoundaryStillLive())
      .then(result => {
        if (!this.coopBoundaryStillLive()) {
          return;
        }
        if (result === "superseded") {
          this.coopPermitRecoveryShown = false;
          this.parkForAuthoritativePermit();
          return;
        }
        globalScene.ui.showText(
          "Could not confirm the shared biome transition. Reconnect, then confirm to retry.",
          null,
          () => {
            if (!this.coopBoundaryStillLive()) {
              return;
            }
            this.coopPermitRecoveryShown = false;
            this.start();
          },
          null,
          true,
        );
      });
  }

  private coopBoundaryStillLive(): boolean {
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    return (
      this.coopGeneration >= 0
      && coopSessionGeneration() === this.coopGeneration
      && (ambientWave === this.coopWave || (this.coopDestinationBattleCreated && ambientWave === this.coopWave + 1))
      && globalScene.phaseManager.getCurrentPhase() === this
    );
  }
}

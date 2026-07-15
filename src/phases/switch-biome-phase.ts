import { globalScene } from "#app/global-scene";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  adoptCoopBiomeTransitionSwitchPermit,
  getCoopBiomeTransitionTailPermit,
  markCoopBiomeTransitionHistoryRecorded,
  markCoopBiomeTransitionSwitchPrepared,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { coopSessionGeneration, failCoopSharedSession, getCoopController } from "#data/elite-redux/coop/coop-runtime";
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
import { getBiomeName } from "#utils/common";

export class SwitchBiomePhase extends BattlePhase {
  public readonly phaseName = "SwitchBiomePhase";
  private readonly nextBiome: BiomeId;
  /** Immutable source boundary captured by SelectBiome before speculative NewBattle state can advance. */
  private readonly coopSourceWave: number | null;
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

  constructor(nextBiome: BiomeId, coopSourceWave: number | null = null) {
    super();

    this.nextBiome = nextBiome;
    this.coopSourceWave =
      coopSourceWave != null && Number.isSafeInteger(coopSourceWave) && coopSourceWave >= 0 ? coopSourceWave : null;
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
      erRecordBiomeEntry(globalScene.arena?.biomeId ?? null);
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

  override end(): void {
    if (this.ended) {
      return;
    }
    try {
      super.end();
      this.ended = true;
    } catch (error) {
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
    return (
      this.coopGeneration >= 0
      && coopSessionGeneration() === this.coopGeneration
      && globalScene.currentBattle?.waveIndex === this.coopWave
      && globalScene.phaseManager.getCurrentPhase() === this
    );
  }
}

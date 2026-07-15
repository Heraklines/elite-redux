import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import {
  applyCoopAuthoritativeBattleState,
  coopAppliedStateTick,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  awaitCoopSettledWaveAdvanceAtBattleEnd,
  broadcastCoopWaveEndState,
  type CoopAutomaticVictorySealIdentity,
  consumeCoopPendingWaveEndState,
  deferCoopAutomaticVictorySealAtBattleEnd,
  failCoopSharedSession,
  getCoopWaveAdvanceRuntimeBinding,
  isCoopAuthoritativeGuest,
  isCoopSettledWaveBoundaryPending,
} from "#data/elite-redux/coop/coop-runtime";
import { coopAuthorityContinuationSurface } from "#data/elite-redux/coop/coop-ui-registry";
import {
  type CoopWaveAdvanceOperationBinding,
  getCoopPendingWaveAdvanceBoundary,
  isValidCoopWaveAdvancePayload,
  registerCoopWaveAdvanceBoundaryDataApplier,
} from "#data/elite-redux/coop/coop-wave-operation";
import { erAdvanceCommunityItemCharges } from "#data/elite-redux/er-community-items";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { advanceErWardStoneCharges } from "#data/elite-redux/er-ward-stones";
import { LapsingPersistentModifier, LapsingPokemonHeldItemModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";

export type RetainedWaveStateAdmission = "applied" | "superseded" | "reapply" | "rejected";

/**
 * Classify a retained transition image against the guest's monotonic state high-water. A newer recovery
 * image satisfies the older transaction's DATA obligation without authorizing a rollback.
 */
export function classifyRetainedWaveStateAdmission(
  applySucceeded: boolean,
  appliedTick: number,
  retainedTick: number | undefined,
): RetainedWaveStateAdmission {
  if (applySucceeded) {
    return "applied";
  }
  if (retainedTick !== undefined && appliedTick > retainedTick) {
    return "superseded";
  }
  if (retainedTick !== undefined && appliedTick === retainedTick) {
    return "reapply";
  }
  return "rejected";
}

/**
 * The one engine-coupled DATA admission seam for retained WAVE_ADVANCE transactions. BattleEnd is the
 * preferred boundary. A source-wave shared input / biome / terminal surface is also safe when a scheduled
 * retry runs immediately after BattleEnd handed off: no later reward result can have applied because it is
 * ordered behind this transaction. Once the next wave begins, applying the old image is forbidden.
 */
registerCoopWaveAdvanceBoundaryDataApplier(envelope => {
  if (!isCoopAuthoritativeGuest()) {
    return "deferred";
  }
  const payload = envelope.pendingOperation?.payload;
  if (envelope.pendingOperation?.kind !== "WAVE_ADVANCE" || !isValidCoopWaveAdvancePayload(payload)) {
    return "rejected";
  }
  const sourceWave = payload.wave;
  const currentWave = globalScene.currentBattle?.waveIndex ?? -1;
  const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
  const exactQueuedBattleEnd =
    phaseName === "BattleEndPhase" && currentWave === sourceWave + 1 && isCoopSettledWaveBoundaryPending(sourceWave);
  const exactGameOverFinalizer =
    payload.outcome === "gameOver" && phaseName === "CoopFinalizeTurnPhase" && currentWave === sourceWave;
  if (currentWave > sourceWave && !exactQueuedBattleEnd) {
    return "rejected";
  }
  if (currentWave !== sourceWave && !exactQueuedBattleEnd) {
    return "deferred";
  }

  let publicSourceBoundary = false;
  try {
    const handlerActive = globalScene.ui.getHandler()?.active === true;
    const surface = handlerActive ? coopAuthorityContinuationSurface(globalScene.ui.getMode()) : null;
    const phaseOwnsPostBattleSharedInput = phaseName === "SelectModifierPhase" || phaseName === "BiomeShopPhase";
    publicSourceBoundary =
      (surface === "sharedInput" && phaseOwnsPostBattleSharedInput)
      || (payload.biomeChange === true && phaseName === "SelectBiomePhase" && handlerActive)
      || (payload.nextWave === sourceWave && phaseName === "GameOverPhase");
  } catch {
    publicSourceBoundary = false;
  }
  if (phaseName !== "BattleEndPhase" && !publicSourceBoundary && !exactGameOverFinalizer) {
    return "deferred";
  }

  const immutableState = structuredClone(envelope.authoritativeState);
  let applied = applyCoopAuthoritativeBattleState(immutableState, true);
  const appliedTick = coopAppliedStateTick();
  const admission = classifyRetainedWaveStateAdmission(applied, appliedTick, immutableState.tick);
  if (admission === "superseded") {
    // A verified recovery image may overtake the older state image retained inside this operation while
    // BattleEnd is still queued. The operation's DATA obligation is already satisfied in that case: never
    // roll the engine back to the older image, but do release this operation's structural continuation.
    // Treating the monotonic rejection as fatal tears the session down after a successful one-heal resync.
    coopLog(
      "progression",
      `GUEST retained WAVE_ADVANCE DATA tick=${immutableState.tick} superseded by recovered tick=${appliedTick}`,
    );
    applied = true;
  } else if (admission === "reapply") {
    applied = reapplyAcceptedCoopAuthoritativeBattleState(immutableState, true);
  }
  return applied ? "applied" : "rejected";
});

export class BattleEndPhase extends BattlePhase {
  public readonly phaseName = "BattleEndPhase";
  /** If true, will increment battles won */
  isVictory: boolean;
  private retainedBoundaryReleased = false;
  private retainedLocalStatsRecorded = false;
  /**
   * A queued phase belongs to the runtime that created it. In production there is one runtime per process,
   * while the two-engine fidelity harness swaps the ambient runtime between clients. Keep the operation
   * ledger owner stable across that delay instead of looking it up again only when BattleEnd eventually starts.
   */
  private readonly retainedWaveBinding: CoopWaveAdvanceOperationBinding | null;
  /** The battle this queued phase closes, before a speculative tail can replace `currentBattle`. */
  private readonly retainedSourceWave: number;
  private readonly retainedSourceWasTrainer: boolean;
  /** Normal retained wins settle only after every automatic post-victory child has drained. */
  private readonly automaticVictorySeal: CoopAutomaticVictorySealIdentity | null;

  constructor(isVictory: boolean, automaticVictorySeal: CoopAutomaticVictorySealIdentity | null = null) {
    super();

    this.isVictory = isVictory;
    this.automaticVictorySeal = automaticVictorySeal;
    this.retainedWaveBinding = getCoopWaveAdvanceRuntimeBinding();
    const retainedBoundary =
      this.retainedWaveBinding == null ? null : getCoopPendingWaveAdvanceBoundary(this.retainedWaveBinding);
    this.retainedSourceWave = retainedBoundary?.wave ?? globalScene.currentBattle?.waveIndex ?? -1;
    this.retainedSourceWasTrainer =
      retainedBoundary == null
        ? globalScene.currentBattle?.trainer != null
        : retainedBoundary.victoryKind === "trainer";
  }

  start() {
    super.start();

    // cull any extra `BattleEnd` phases from the queue.
    this.isVictory ||= globalScene.phaseManager.hasPhaseOfType(
      "BattleEndPhase",
      (phase: BattleEndPhase) => phase.isVictory,
    );
    globalScene.phaseManager.removeAllPhasesOfType("BattleEndPhase");

    const retainedBinding = this.retainedWaveBinding ?? getCoopWaveAdvanceRuntimeBinding();
    if (isCoopAuthoritativeGuest() && retainedBinding == null) {
      failCoopSharedSession(`The retained wave ${this.retainedSourceWave} BattleEnd had no owning runtime.`);
      return;
    }

    // P33 guest: the host's post-BattleEnd image already contains every mutation below. Hold this phase
    // until that exact retained DATA applies, then release the existing host-stated tail without dual-run.
    if (
      awaitCoopSettledWaveAdvanceAtBattleEnd(
        () => this.releaseRetainedBoundary(),
        retainedBinding,
        this.retainedSourceWave,
      )
    ) {
      return;
    }

    // Legacy/no-journal guest compatibility. Retained peers ignore raw waveEndState entirely.
    this.applyLegacyCoopWaveEndProgression();

    this.recordLocalBattleStats();

    if (this.isVictory) {
      globalScene.currentBattle.addBattleScore();

      // ER money streak (#348): a won wave extends every non-fainted party
      // mon's faint-free streak (+1% money per 3 waves, capped +10%/mon).
      advanceErMoneyStreaks();
      // ER Ward Stones (#358): player-held stones charge up over won waves.
      advanceErWardStoneCharges();
      erAdvanceCommunityItemCharges();
    }

    // Endless graceful end
    if (globalScene.gameMode.isEndless && globalScene.currentBattle.waveIndex >= 5850) {
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.phaseManager.unshiftNew("GameOverPhase", true);
    }

    for (const pokemon of globalScene.getPokemonAllowedInBattle()) {
      applyAbAttrs("PostBattleAbAttr", { pokemon, victory: this.isVictory });
    }

    if (globalScene.currentBattle.moneyScattered) {
      globalScene.currentBattle.pickUpScatteredMoney();
    }

    globalScene.clearEnemyHeldItemModifiers();

    const lapsingModifiers = globalScene.findModifiers(
      m => m instanceof LapsingPersistentModifier || m instanceof LapsingPokemonHeldItemModifier,
    ) as (LapsingPersistentModifier | LapsingPokemonHeldItemModifier)[];
    for (const m of lapsingModifiers) {
      const args: any[] = [];
      if (m instanceof LapsingPokemonHeldItemModifier) {
        args.push(globalScene.getPokemonById(m.pokemonId));
      }
      if (!m.lapse(...args)) {
        globalScene.removeModifier(m);
      }
    }

    globalScene.updateModifiers();
    // Normal retained wins still have automatic TrainerVictory/Money/Modifier/Egg/buff/heal children ahead
    // of their first interactive continuation. Stage that exact phase-owned boundary here and let the
    // explicit CoopVictorySealPhase capture after those children drain. Capture/flee and legacy sessions
    // retain the established BattleEnd settlement timing.
    if (!deferCoopAutomaticVictorySealAtBattleEnd(this.automaticVictorySeal)) {
      broadcastCoopWaveEndState(this.isVictory);
    }
    // Keep the enemy objects serializable through the settled capture, then tear down presentation exactly
    // as before. The retained post-battle image explicitly marks enemy seats hidden on the guest.
    for (const p of globalScene.getEnemyParty()) {
      try {
        p.destroy();
      } catch {
        console.warn("Unable to destroy stale pokemon object in BattleEndPhase:", p);
      }
    }
    this.end();
  }

  private releaseRetainedBoundary(): void {
    if (this.retainedBoundaryReleased) {
      return;
    }
    // Account progression belongs to each local player and is intentionally absent from shared-run DATA.
    // Preserve it once on the guest while every shared mechanical mutation remains host-authoritative.
    if (!this.retainedLocalStatsRecorded) {
      this.recordLocalBattleStats();
      this.retainedLocalStatsRecorded = true;
    }
    coopLog("progression", `GUEST retained WAVE_ADVANCE BattleEnd release wave=${this.retainedSourceWave}`);
    this.end();
    this.retainedBoundaryReleased = true;
  }

  private recordLocalBattleStats(): void {
    globalScene.gameData.gameStats.battles++;
    if (
      globalScene.gameMode.isEndless
      && this.retainedSourceWave + 1 > globalScene.gameData.gameStats.highestEndlessWave
    ) {
      globalScene.gameData.gameStats.highestEndlessWave = this.retainedSourceWave + 1;
    }
    if (this.isVictory && this.retainedSourceWasTrainer) {
      globalScene.gameData.gameStats.trainersDefeated++;
    }
  }

  /**
   * Co-op authoritative progression sync. Party progression authority lands HERE, after the wave's whole
   * exp/level/evolution chain has drained (those phases are unshifted ahead of this pushed BattleEndPhase).
   *  - HOST: streams the WAVE-END authoritative full-state snapshot (#838, whole party as PokemonData) so
   *    the guest converges levels / exp / learned moves / evolved species through the between-wave shop.
   *  - GUEST: its own `applyPartyExp` is gated off (victory-phase.ts), so it adopts the host's wave-end
   *    snapshot via ONE id-based full-state apply.
   * Both arms are hard no-ops off the authoritative path (host gates internal; guest gate explicit), so
   * solo / host-owner / lockstep are byte-for-byte unchanged.
   */
  private applyLegacyCoopWaveEndProgression(): void {
    if (!isCoopAuthoritativeGuest()) {
      return;
    }
    // GUEST: adopt the host's WAVE-END authoritative full-state snapshot via one id-based apply.
    const waveEndState = consumeCoopPendingWaveEndState() ?? undefined;
    const applied = applyCoopAuthoritativeBattleState(waveEndState, true);
    coopLog(
      "progression",
      `GUEST waveEndState APPLY wave=${globalScene.currentBattle.waveIndex} applied=${applied} tick=${waveEndState?.tick ?? -1}`,
    );
  }
}

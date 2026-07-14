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
  consumeCoopPendingWaveEndState,
  failCoopSharedSession,
  getCoopWaveAdvanceRuntimeBinding,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import { coopAuthorityContinuationSurface } from "#data/elite-redux/coop/coop-ui-registry";
import {
  isValidCoopWaveAdvancePayload,
  registerCoopWaveAdvanceBoundaryDataApplier,
  tryApplyCoopWaveAdvanceDataAtBoundary,
} from "#data/elite-redux/coop/coop-wave-operation";
import { erAdvanceCommunityItemCharges } from "#data/elite-redux/er-community-items";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { advanceErWardStoneCharges } from "#data/elite-redux/er-ward-stones";
import { LapsingPersistentModifier, LapsingPokemonHeldItemModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";

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
  if (currentWave > sourceWave) {
    return "rejected";
  }
  if (currentWave !== sourceWave) {
    return "deferred";
  }

  const phaseName = globalScene.phaseManager?.getCurrentPhase()?.phaseName;
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
  if (phaseName !== "BattleEndPhase" && !publicSourceBoundary) {
    return "deferred";
  }

  const immutableState = structuredClone(envelope.authoritativeState);
  let applied = applyCoopAuthoritativeBattleState(immutableState, true);
  if (!applied && coopAppliedStateTick() === immutableState.tick) {
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

  constructor(isVictory: boolean) {
    super();

    this.isVictory = isVictory;
  }

  start() {
    super.start();

    // cull any extra `BattleEnd` phases from the queue.
    this.isVictory ||= globalScene.phaseManager.hasPhaseOfType(
      "BattleEndPhase",
      (phase: BattleEndPhase) => phase.isVictory,
    );
    globalScene.phaseManager.removeAllPhasesOfType("BattleEndPhase");

    // Make BattleEnd itself the deterministic DATA wake. Polling and UI notifications remain backstops,
    // but correctness no longer depends on a retry timer happening to fire while this short phase is live.
    if (isCoopAuthoritativeGuest()) {
      const wave = globalScene.currentBattle?.waveIndex ?? -1;
      const binding = getCoopWaveAdvanceRuntimeBinding();
      if (binding == null) {
        failCoopSharedSession(`The retained wave ${wave} BattleEnd had no owning runtime.`);
        return;
      }
      const dataOutcome = tryApplyCoopWaveAdvanceDataAtBoundary(wave, binding);
      if (dataOutcome === "rejected") {
        failCoopSharedSession(`Could not apply the complete retained state at wave ${wave} BattleEnd.`);
        return;
      }
    }

    // P33 guest: the host's post-BattleEnd image already contains every mutation below. Hold this phase
    // until that exact retained DATA applies, then release the existing host-stated tail without dual-run.
    if (awaitCoopSettledWaveAdvanceAtBattleEnd(() => this.releaseRetainedBoundary())) {
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
    // HOST: capture only after every BattleEnd stat/modifier/material mutation above has settled. This
    // seals DATA + destination in the retained WAVE_ADVANCE envelope, then emits raw compatibility state.
    broadcastCoopWaveEndState(this.isVictory);
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
    coopLog("progression", `GUEST retained WAVE_ADVANCE BattleEnd release wave=${globalScene.currentBattle.waveIndex}`);
    this.end();
    this.retainedBoundaryReleased = true;
  }

  private recordLocalBattleStats(): void {
    globalScene.gameData.gameStats.battles++;
    if (
      globalScene.gameMode.isEndless
      && globalScene.currentBattle.waveIndex + 1 > globalScene.gameData.gameStats.highestEndlessWave
    ) {
      globalScene.gameData.gameStats.highestEndlessWave = globalScene.currentBattle.waveIndex + 1;
    }
    if (this.isVictory && globalScene.currentBattle.trainer) {
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

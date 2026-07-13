import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { applyCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  awaitCoopSettledWaveAdvanceAtBattleEnd,
  broadcastCoopWaveEndState,
  consumeCoopPendingWaveEndState,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import { erAdvanceCommunityItemCharges } from "#data/elite-redux/er-community-items";
import { advanceErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { advanceErWardStoneCharges } from "#data/elite-redux/er-ward-stones";
import { LapsingPersistentModifier, LapsingPokemonHeldItemModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";

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

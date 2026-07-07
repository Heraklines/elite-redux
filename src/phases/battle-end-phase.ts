import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { applyCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
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

  constructor(isVictory: boolean) {
    super();

    this.isVictory = isVictory;
  }

  start() {
    super.start();

    this.syncCoopWaveEndProgression();

    // cull any extra `BattleEnd` phases from the queue.
    this.isVictory ||= globalScene.phaseManager.hasPhaseOfType(
      "BattleEndPhase",
      (phase: BattleEndPhase) => phase.isVictory,
    );
    globalScene.phaseManager.removeAllPhasesOfType("BattleEndPhase");

    globalScene.gameData.gameStats.battles++;
    if (
      globalScene.gameMode.isEndless
      && globalScene.currentBattle.waveIndex + 1 > globalScene.gameData.gameStats.highestEndlessWave
    ) {
      globalScene.gameData.gameStats.highestEndlessWave = globalScene.currentBattle.waveIndex + 1;
    }

    if (this.isVictory) {
      globalScene.currentBattle.addBattleScore();

      if (globalScene.currentBattle.trainer) {
        globalScene.gameData.gameStats.trainersDefeated++;
      }
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
    for (const p of globalScene.getEnemyParty()) {
      try {
        p.destroy();
      } catch {
        console.warn("Unable to destroy stale pokemon object in BattleEndPhase:", p);
      }
    }

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
    this.end();
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
  private syncCoopWaveEndProgression(): void {
    if (globalScene.gameMode.isCoop) {
      coopLog(
        "progression",
        `waveEndState BROADCAST wave=${globalScene.currentBattle.waveIndex} (host streams authoritative snapshot)`,
      );
    }
    broadcastCoopWaveEndState();
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

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { applyCoopExpDeltas } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  broadcastCoopExpResolved,
  consumeCoopPendingExpDeltas,
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

    // Co-op authoritative (#633 B5): EXP authority lands HERE, after the wave's whole exp/level/
    // evolution chain has drained (those phases are unshifted ahead of this pushed BattleEndPhase).
    //  - HOST: stream each party slot's SETTLED exp/level/moveset so the guest can mirror it (the
    //    pre-exp `waveResolved` win-broadcast would carry STALE values - `applyPartyExp` only QUEUES
    //    the exp phases; the mutation happens later inside them).
    //  - GUEST: its own `applyPartyExp` is gated off (victory-phase.ts), so adopt the host's settled
    //    deltas here - level/exp + the level-up moves it never learned (it runs no LevelUpPhase).
    // Both are hard no-ops off the authoritative path (host gate internal; guest gate explicit), so
    // solo / host-owner / lockstep are byte-for-byte unchanged.
    // HOST: stream settled per-slot exp deltas (internally no-op off host). Log on co-op only so
    // solo / lockstep stay silent; the broadcast itself decides whether anything goes on the wire.
    if (globalScene.gameMode.isCoop) {
      coopLog("progression", `expResolved BROADCAST wave=${globalScene.currentBattle.waveIndex} (host streams settled deltas)`);
    }
    broadcastCoopExpResolved();
    if (isCoopAuthoritativeGuest()) {
      // GUEST: adopt the host's settled deltas (level/exp + level-up moves it never learned).
      const deltas = consumeCoopPendingExpDeltas() ?? undefined;
      coopLog(
        "progression",
        `GUEST applyExpDeltas APPLY wave=${globalScene.currentBattle.waveIndex} count=${deltas?.length ?? 0} slots=[${deltas?.map(d => `${d.slot}:lv${d.level}:exp${d.exp}`).join(",") ?? ""}]`,
      );
      applyCoopExpDeltas(deltas);
    }

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
}

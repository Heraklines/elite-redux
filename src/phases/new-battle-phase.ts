import { globalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { BattlePhase } from "#phases/battle-phase";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    globalScene.newBattle();

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
      const isBeatWave = wave > 0 && wave % 3 === 0;
      console.info(
        `[llm-director] NewBattlePhase wave=${wave}, isBeatWave=${isBeatWave}, mode=${globalScene.gameMode.modeId}`,
      );
      if (isBeatWave) {
        console.info(`[llm-director] Unshifting LLMDirectorBeatPhase for wave ${wave}`);
        globalScene.phaseManager.unshiftNew("LLMDirectorBeatPhase", wave);
      }
    }

    this.end();
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
    const snapshot = { enemyLevels: battle.enemyLevels };
    const applied = applyOverrideToBattle(snapshot, override);
    if (applied && snapshot.enemyLevels) {
      battle.enemyLevels = snapshot.enemyLevels;
    }
    const swapCount = override.trainerOverride?.speciesSwaps?.length ?? 0;
    if (swapCount > 0) {
      // v2: thread species swaps into trainer.genPartyMember.
      console.info(
        `[llm-director] interBeatOverride.speciesSwaps received for wave ${battle.waveIndex} (deferred to v2)`,
      );
    }
  }
}

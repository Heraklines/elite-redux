import { globalScene } from "#app/global-scene";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { logBiomeSwitch } from "#system/llm-director/director-log";
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

    this.end();
  }

  /**
   * If `wave` is the start (waveStart) of a story bible act, switch to that
   * act's designated biome. Keeps the visual location in sync with the
   * narrative — a smuggler's-den arc plays in a CAVE, a court drama in a
   * TEMPLE, etc. No-op if the bible isn't loaded or the wave isn't a boundary.
   */
  private applyActBiomeSwitch(wave: number): void {
    const bible = globalScene.gameData.llmDirectorState?.storyBible;
    if (!bible || wave <= 0) {
      return;
    }
    const act = bible.acts.find(a => a.waveStart === wave);
    if (!act || typeof act.biomeId !== "number") {
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
    // Story-themed pre-battle line: queue the LLM-written narration for
    // this wave so the trainer encounter feels part of the run's story
    // instead of a vanilla wave with canned trainer-class dialogue.
    if (override.preBattleText) {
      void globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.phaseManager.queueMessage(override.preBattleText, null, true);
    }
  }
}

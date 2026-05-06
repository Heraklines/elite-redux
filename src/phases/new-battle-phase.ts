import { globalScene } from "#app/global-scene";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { clampAuthoredTeam } from "#system/llm-director/authored-team";
import { logBiomeSwitch, logTrainerNarrationApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { installAuthoredTeam } from "#system/llm-director/install-authored-team";
import { paginate } from "#system/llm-director/text-pagination";

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
    // v2 Phase A: full LLM-authored team. Apply BEFORE levelDelta so the
    // authored levels are clamped against the wave-curve baseline (not
    // against post-delta levels), and so genPartyMember sees the correct
    // enemyLevels when EncounterPhase calls it.
    const enemyTeam = override.trainerOverride?.enemyTeam;
    if (enemyTeam && enemyTeam.length > 0) {
      this.applyAuthoredEnemyTeam(battle.waveIndex, enemyTeam, override.trainerOverride?.levelDelta);
    } else {
      const snapshot = { enemyLevels: battle.enemyLevels };
      const applied = applyOverrideToBattle(snapshot, override);
      if (applied && snapshot.enemyLevels) {
        battle.enemyLevels = snapshot.enemyLevels;
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
      // CRITICAL: paginate before queueMessage. The Phaser dialog box has
      // maxLines=2 and silently truncates anything past that. Without `$`
      // separators, a 150+ char preBattleText shows ~120 chars and the
      // player presses A to advance, hitting the next phase (the actual
      // wild/trainer fight) without seeing the rest of the narration.
      void globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.phaseManager.queueMessage(paginate(override.preBattleText), null, true);
      logTrainerNarrationApplied(battle.waveIndex, override.preBattleText);
    }
    // Trainer name override: best-effort cosmetic so the trainer is
    // displayed as "Concordat Ranger Vance" instead of "Ranger Joe".
    if (override.trainerName && battle.trainer) {
      battle.trainer.name = override.trainerName;
    }
    // Trainer sprite override: switching trainerType mid-NewBattle is
    // invasive and risks breaking the encounter pipeline. Deferred to v3
    // when we hook into the trainer-creation step earlier in the flow.
    if (override.trainerOverride?.trainerType !== undefined) {
      console.info(
        `[llm-director] trainer-sprite-override wave=${battle.waveIndex} requested trainerType=${override.trainerOverride.trainerType} (deferred to v3 — needs trainer-creation hook, not post-create)`,
      );
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

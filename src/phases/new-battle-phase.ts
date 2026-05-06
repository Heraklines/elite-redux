import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Trainer } from "#field/trainer";
import { BattlePhase } from "#phases/battle-phase";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { clampAuthoredTeam } from "#system/llm-director/authored-team";
import { logBiomeSwitch, logTrainerNarrationApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { installAuthoredTeam } from "#system/llm-director/install-authored-team";
import { paginate } from "#system/llm-director/text-pagination";
import { trainerConfigs } from "#trainers/trainer-config";

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
    // Trainer-sprite override: if the LLM picked a specific trainerType for
    // this wave, swap the existing trainer instance for one of the requested
    // type BEFORE installAuthoredTeam binds to it. This must happen before
    // enemyTeam application because installAuthoredTeam mutates the bound
    // trainer's config; we want the new trainer's config (matching the
    // narration's sprite) to receive those mutations.
    const requestedTrainerType = override.trainerOverride?.trainerType;
    if (
      typeof requestedTrainerType === "number"
      && battle.battleType === BattleType.TRAINER
      && battle.trainer
      && requestedTrainerType !== battle.trainer.config.trainerType
    ) {
      this.applyTrainerTypeOverride(battle.waveIndex, requestedTrainerType);
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
   * Replace the current battle's trainer with one of the LLM-requested type.
   *
   * `globalScene.newBattle()` (called at the top of NewBattlePhase) has
   * already created a Trainer of the wave-curve-rolled trainerType, added
   * it to `globalScene.field`, and stored it on `battle.trainer`. By the
   * time this runs, the old trainer is fully constructed but its sprite
   * assets haven't been loaded yet — that happens later in EncounterPhase
   * via `battle.trainer?.loadAssets().then(initSprite)`. So we can swap
   * the trainer instance cleanly here and EncounterPhase will load assets
   * for the new one.
   *
   * Refuses to swap to:
   *   - id 0 (UNKNOWN sentinel)
   *   - id >= 200 (named gym leaders / elite four / champions / rivals;
   *     these have fixed canonical teams and special UI handling that
   *     would break if hijacked by the LLM)
   *   - unknown trainerConfigs entries
   * Skips silently if the requested type matches the existing trainer.
   *
   * Variant is preserved from the original (DEFAULT / FEMALE / DOUBLE);
   * the Trainer constructor falls back to DEFAULT if the new config
   * doesn't support the requested variant.
   */
  private applyTrainerTypeOverride(waveIndex: number, requestedType: number): void {
    const battle = globalScene.currentBattle;
    if (!battle?.trainer) {
      return;
    }
    if (requestedType <= TrainerType.UNKNOWN || requestedType >= 200) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: id=${requestedType} is reserved (gym leader / champion / rival / unknown sentinel)`,
      );
      return;
    }
    const newConfig = trainerConfigs[requestedType as TrainerType];
    if (!newConfig) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: no trainerConfig for id=${requestedType}`,
      );
      return;
    }
    const oldTrainer = battle.trainer;
    const oldVariant = oldTrainer.variant;
    // If the original was DOUBLE and the new config doesn't support double,
    // fall back to DEFAULT — Trainer's constructor handles this internally,
    // but we surface it to the log so behavior is debuggable.
    let chosenVariant = oldVariant;
    if (oldVariant === TrainerVariant.DOUBLE && !newConfig.hasDouble && !newConfig.doubleOnly) {
      chosenVariant = TrainerVariant.DEFAULT;
    }
    if (oldVariant === TrainerVariant.FEMALE && !newConfig.hasGenders) {
      chosenVariant = TrainerVariant.DEFAULT;
    }
    if (newConfig.doubleOnly && oldVariant !== TrainerVariant.DOUBLE) {
      // newConfig requires double but battle isn't set up for it — refuse,
      // because changing battle.double mid-construction would cascade into
      // FieldPosition / SummonPhase logic we don't want to mess with.
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: id=${requestedType} is double-only but battle is single`,
      );
      return;
    }
    try {
      const newTrainer = new Trainer(requestedType as TrainerType, chosenVariant);
      // If the original had a custom display name, preserve it on the new
      // instance so the LLM's `trainerName` override (applied later in this
      // method) stays consistent.
      if (oldTrainer.name) {
        newTrainer.name = oldTrainer.name;
      }
      // Detach old trainer from the field and destroy its Phaser resources.
      // destroy() walks parent containers and removes itself; explicit
      // remove() first is belt-and-braces in case the trainer was added to
      // a custom container at any point.
      globalScene.field.remove(oldTrainer, false);
      oldTrainer.destroy();
      // Wire the new trainer in. EncounterPhase will load its sprite assets
      // when it runs `battle.trainer?.loadAssets().then(initSprite)`.
      globalScene.field.add(newTrainer);
      battle.trainer = newTrainer;
      console.info(
        `[llm-director] trainer-type-override applied wave=${waveIndex} oldType=${oldTrainer.config.trainerType} newType=${requestedType} variant=${chosenVariant}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-director] trainer-type-override failed wave=${waveIndex} reason=${reason}`);
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

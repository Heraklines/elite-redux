import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { BattlePhase } from "#phases/battle-phase";
import { installErCustomTrainerForCurrentWave } from "#phases/er-custom-trainer-install";
import { applyOverrideToBattle } from "#phases/llm-director-beat-utils";
import { clampAuthoredTeam } from "#system/llm-director/authored-team";
import { logBiomeSwitch, logTrainerNarrationApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { installAuthoredTeam } from "#system/llm-director/install-authored-team";
import { paginate } from "#system/llm-director/text-pagination";
import { trainerConfigs } from "#trainers/trainer-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    globalScene.newBattle();

    // Elite Redux: staff-authored custom trainers (er-custom-trainers.json).
    // Runs after newBattle() has built the wave but before EncounterPhase's
    // genPartyMember, so we can convert the wave into the authored trainer.
    installErCustomTrainerForCurrentWave();

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
   * act's designated biome AND fire a bible-refinement pass in the
   * background so the next act's beats benefit from a re-read of the
   * run-so-far. Refinement is opportunistic — it doesn't block the act
   * transition, and falls back to the original bible silently on failure.
   * Keeps the visual location in sync with the narrative — a smuggler's-
   * den arc plays in a CAVE, a court drama in a TEMPLE, etc. No-op if
   * the bible isn't loaded or the wave isn't a boundary.
   */
  private applyActBiomeSwitch(wave: number): void {
    const state = globalScene.gameData.llmDirectorState;
    const bible = state?.storyBible;
    if (!bible || wave <= 0) {
      return;
    }
    const act = bible.acts.find(a => a.waveStart === wave);
    if (!act) {
      return;
    }
    // Fire a refinement pass in the background. Don't await; the next
    // beat envelope picks up the refined bible if it lands in time.
    const runtime = getDirectorRuntime();
    if (runtime && state) {
      void import("#system/llm-director/refine-story-bible").then(({ refineStoryBible }) =>
        refineStoryBible(runtime.client, { bible, state })
          .then(refined => {
            if (refined) {
              state.storyBible = refined;
              console.info(`[llm-director] bible refined at act boundary wave=${wave} act=${act.name}`);
            }
          })
          .catch(err => {
            console.warn(
              `[llm-director] bible refinement crashed wave=${wave}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
      );
    }
    if (typeof act.biomeId !== "number") {
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
    // ── BATTLE-TYPE OVERRIDES (priority order) ──────────────────────────
    // Each override below can transform what the upcoming wave actually IS:
    //   forceMysteryEncounter   wave -> MYSTERY_ENCOUNTER (vanilla pool)
    //   wildEncounter           wave -> WILD with LLM-specified Pokemon
    //   trainerOverride.enemyTeam   wave -> TRAINER with LLM-authored team
    //   trainerOverride.trainerType  wave -> TRAINER with LLM-specified sprite
    // Higher priority transforms run first; lower-priority transforms only
    // apply if the higher-priority ones didn't fire.
    if (override.forceMysteryEncounter) {
      this.applyForceMysteryEncounter(battle.waveIndex);
    } else if (override.wildEncounter && override.wildEncounter.pokemon.length > 0) {
      this.applyWildEncounterOverride(battle.waveIndex, override.wildEncounter);
    } else {
      // Trainer override path. Two sub-cases:
      //  (a) wave was already TRAINER, requested type differs → swap sprite
      //  (b) wave was WILD but the LLM emitted trainerType OR enemyTeam →
      //      convert WILD→TRAINER so the narration matches the actual fight.
      // (b) is critical: without it, the LLM writes "a Grass Kingdom ranger
      // blocks the path" but the player faces a random wild Sentret because
      // vanilla rolled WILD that wave and we only set trainerType which is
      // a no-op for non-trainer waves.
      const trOver = override.trainerOverride;
      const wantsTrainer =
        !!trOver
        && (typeof trOver.trainerType === "number" || (Array.isArray(trOver.enemyTeam) && trOver.enemyTeam.length > 0));
      if (wantsTrainer && battle.battleType === BattleType.WILD) {
        this.convertWildToTrainer(battle.waveIndex, trOver.trainerType);
      }
      const requestedTrainerType = trOver?.trainerType;
      const hasEnemyTeam = !!(trOver?.enemyTeam && trOver.enemyTeam.length > 0);
      if (
        typeof requestedTrainerType === "number"
        && battle.battleType === BattleType.TRAINER
        && battle.trainer
        && requestedTrainerType !== battle.trainer.config.trainerType
      ) {
        this.applyTrainerTypeOverride(battle.waveIndex, requestedTrainerType, hasEnemyTeam);
      }
    }
    // Mid-act biome switch: orthogonal to battle-type — just queue the
    // SwitchBiomePhase before EncounterPhase runs. The new biome is in
    // place by the time the wave actually plays.
    if (override.biomeChange && typeof override.biomeChange.biomeId === "number") {
      const targetBiome = override.biomeChange.biomeId as BiomeId;
      const currentBiome = globalScene.arena?.biomeId;
      if (currentBiome !== targetBiome) {
        logBiomeSwitch(`override-wave-${battle.waveIndex}`, currentBiome, targetBiome);
        globalScene.phaseManager.unshiftNew("SwitchBiomePhase", targetBiome);
      }
    }
    // LLM-authored trainer team. Skipped if a higher-priority override
    // already transformed the wave (forceMysteryEncounter / wildEncounter)
    // — those replace the entire battle setup, so a trainer-team override
    // would be moot. Still applies levelDelta in the no-team case.
    const enemyTeam = override.trainerOverride?.enemyTeam;
    const isTransformedToWildOrME =
      override.forceMysteryEncounter || (override.wildEncounter && override.wildEncounter.pokemon.length > 0);
    if (!isTransformedToWildOrME) {
      if (enemyTeam && enemyTeam.length > 0 && battle.battleType === BattleType.TRAINER) {
        this.applyAuthoredEnemyTeam(battle.waveIndex, enemyTeam, override.trainerOverride?.levelDelta);
      } else {
        const snapshot = { enemyLevels: battle.enemyLevels };
        const applied = applyOverrideToBattle(snapshot, override);
        if (applied && snapshot.enemyLevels) {
          battle.enemyLevels = snapshot.enemyLevels;
        }
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
      // For trainer waves: REPLACE the canonical "I challenge you!" line
      // with the LLM's preBattleText via the per-instance
      // encounterMessagesOverride. The standard EncounterPhase flow then
      // shows our text with the trainer's name as speaker, character
      // sprite if any, and proper timing (after the trainer slides in,
      // before the first Pokemon summons). No separate MessagePhase.
      //
      // For wild waves and mystery encounters: queue a MessagePhase as
      // before (no trainer instance to attach the override to).
      if (battle.battleType === BattleType.TRAINER && battle.trainer) {
        // Paginate so the in-battle dialog respects the 2-line cap.
        battle.trainer.encounterMessagesOverride = [paginate(override.preBattleText)];
      } else {
        void globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.phaseManager.queueMessage(paginate(override.preBattleText), null, true);
      }
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
  /**
   * Convert a WILD wave to a TRAINER wave by spawning a Trainer instance
   * from scratch. Used when the LLM's preBattleText narration implies a
   * trainer fight (named NPC, faction-tagged opponent) but vanilla rolled
   * WILD for this wave and there's no existing trainer to swap.
   *
   * If `requestedType` is provided and valid, uses it. Otherwise picks a
   * neutral fallback (BACKPACKER) so the narration still gets a
   * matching-ish sprite. The caller's subsequent installAuthoredTeam
   * step (when enemyTeam is set) will populate the team; otherwise the
   * trainer's vanilla party templates run.
   */
  private convertWildToTrainer(waveIndex: number, requestedType: number | undefined): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    let chosenType: TrainerType = TrainerType.BACKPACKER;
    if (typeof requestedType === "number" && requestedType > TrainerType.UNKNOWN && requestedType < 200) {
      const cfg = trainerConfigs[requestedType as TrainerType];
      if (cfg && !cfg.doubleOnly) {
        chosenType = requestedType as TrainerType;
      }
    }
    try {
      const variant = TrainerVariant.DEFAULT;
      const newTrainer = new Trainer(chosenType, variant);
      globalScene.field.add(newTrainer);
      battle.trainer = newTrainer;
      battle.battleType = BattleType.TRAINER;
      // Wipe any wild Pokemon that vanilla pre-loaded so EncounterPhase
      // generates the trainer party fresh via genPartyMember.
      battle.enemyParty = [];
      // Trainer parties typically use the wave-curve-derived enemyLevels;
      // keep whatever vanilla set, just truncate to single-battle size.
      const baseLevel = battle.enemyLevels?.[0] ?? Math.max(5, waveIndex);
      battle.enemyLevels = [baseLevel];
      battle.setDouble(false);
      console.info(
        `[llm-director] wild-to-trainer conversion wave=${waveIndex} chosenType=${chosenType} (LLM requested type=${requestedType ?? "none"})`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-director] wild-to-trainer conversion failed wave=${waveIndex} reason=${reason}`);
    }
  }

  private applyTrainerTypeOverride(waveIndex: number, requestedType: number, hasEnemyTeam: boolean): void {
    const battle = globalScene.currentBattle;
    if (!battle?.trainer) {
      return;
    }
    if (requestedType <= TrainerType.UNKNOWN) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: id=${requestedType} is the UNKNOWN sentinel`,
      );
      return;
    }
    // Named trainers (id >= 200, gym leaders / E4 / champions / rivals)
    // have fixed canonical teams that are usually dramatically scaled
    // for endgame. Refuse the swap when the LLM didn't provide enemyTeam
    // (otherwise wave 5 would face a champion's level-60 lineup). With
    // enemyTeam, installAuthoredTeam overwrites the canonical party so
    // only the SPRITE is borrowed — perfect for "the rival's apprentice"
    // / "a champion-style ace appears" / etc.
    if (requestedType >= 200 && !hasEnemyTeam) {
      console.warn(
        `[llm-director] trainer-type-override wave=${waveIndex} rejected: named-trainer id=${requestedType} requires trainerOverride.enemyTeam (canonical team would otherwise surface). Sprite reuse for named trainers is allowed, but the LLM must spec the team.`,
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
   * Convert the wave to a WILD encounter populated with the LLM-specified
   * Pokemon. If the wave was originally TRAINER, the trainer is destroyed
   * first. The enemyParty is pre-populated so EncounterPhase reuses it
   * (skipping its own `globalScene.randomSpecies` roll — see the
   * `!battle.enemyParty[e]` guard added in encounter-phase.ts).
   *
   * Up to 2 Pokemon (single or double battle). Each entry's level defaults
   * to the wave-curve baseline; abilityIndex / moveIds / nickname / shiny
   * are honored when valid; held items granted via consequence.effects
   * paths instead (we don't apply heldItemKeys for wild encounters since
   * vanilla wild Pokemon don't carry held items by default).
   */
  private applyWildEncounterOverride(
    waveIndex: number,
    spec: { pokemon: import("#data/llm-director/beat-schema").AuthoredPokemon[]; isBoss?: boolean },
  ): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    // Tear down the trainer if there was one.
    if (battle.battleType === BattleType.TRAINER && battle.trainer) {
      try {
        globalScene.field.remove(battle.trainer, false);
        battle.trainer.destroy();
      } catch (err) {
        console.warn(
          `[llm-director] wild-encounter-override wave=${waveIndex} trainer-destroy warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      battle.trainer = null;
    }
    battle.battleType = BattleType.WILD;
    const baseLevel = battle.enemyLevels?.[0] ?? Math.max(5, waveIndex);
    const finalLevels: number[] = [];
    battle.enemyParty = [];
    for (let i = 0; i < spec.pokemon.length && i < 2; i++) {
      const p = spec.pokemon[i];
      const species = getPokemonSpecies(p.speciesId);
      if (!species) {
        console.warn(`[llm-director] wild-encounter-override wave=${waveIndex} unknown speciesId=${p.speciesId}`);
        continue;
      }
      const level = Math.max(1, Math.floor(p.level ?? baseLevel));
      const isBoss = !!p.isBoss || !!spec.isBoss;
      try {
        const enemy = globalScene.addEnemyPokemon(species, level, TrainerSlot.NONE, isBoss);
        if (Array.isArray(p.moveIds) && p.moveIds.length > 0) {
          enemy.moveset = p.moveIds.slice(0, 4).map(id => new PokemonMove(id));
        }
        // AuthoredPokemon uses `abilityId` (the Ability enum value); the
        // EnemyPokemon's `abilityIndex` is the slot (0=ability1, 1=ability2,
        // 2=hidden) into its species. Map by matching the requested ability.
        if (typeof p.abilityId === "number" && p.abilityId >= 0) {
          const slot =
            species.ability1 === p.abilityId
              ? 0
              : species.ability2 === p.abilityId
                ? 1
                : species.abilityHidden === p.abilityId
                  ? 2
                  : -1;
          if (slot >= 0) {
            enemy.abilityIndex = slot;
          }
        }
        if (p.shiny) {
          enemy.shiny = true;
        }
        battle.enemyParty.push(enemy);
        finalLevels.push(level);
      } catch (err) {
        console.warn(
          `[llm-director] wild-encounter-override wave=${waveIndex} addEnemyPokemon failed for speciesId=${p.speciesId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    battle.enemyLevels = finalLevels;
    battle.setDouble(battle.enemyParty.length > 1);
    console.info(
      `[llm-director] wild-encounter-override applied wave=${waveIndex} count=${battle.enemyParty.length} levels=[${finalLevels.join(",")}] boss=${!!spec.isBoss}`,
    );
  }

  /**
   * Convert the wave to a vanilla MYSTERY_ENCOUNTER. PokeRogue's existing
   * `EncounterPhase` then runs the standard mystery-encounter pipeline:
   * picks an eligible encounter from the biome pool, sets up sprites, and
   * queues `MysteryEncounterPhase` for the option-select UI. This gives
   * the LLM an "I want a vanilla mystery event here" lever, alongside the
   * LLM-authored dialogue beats.
   */
  private applyForceMysteryEncounter(waveIndex: number): void {
    const battle = globalScene.currentBattle;
    if (!battle) {
      return;
    }
    if (battle.battleType === BattleType.TRAINER && battle.trainer) {
      try {
        globalScene.field.remove(battle.trainer, false);
        battle.trainer.destroy();
      } catch (err) {
        console.warn(
          `[llm-director] force-mystery-encounter wave=${waveIndex} trainer-destroy warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      battle.trainer = null;
    }
    battle.battleType = BattleType.MYSTERY_ENCOUNTER;
    // Leave battle.mysteryEncounter undefined so EncounterPhase fills it
    // from the vanilla pool (`globalScene.getMysteryEncounter(undefined)`
    // rolls by tier weight against the biome's eligible list).
    battle.mysteryEncounter = undefined;
    battle.mysteryEncounterType = MysteryEncounterType.MYSTERIOUS_CHEST;
    console.info(`[llm-director] force-mystery-encounter applied wave=${waveIndex} (vanilla pool roll)`);
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

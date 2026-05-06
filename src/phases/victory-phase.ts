import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import type { ModifierType } from "#modifiers/modifier-type";
import { handleMysteryEncounterVictory } from "#mystery-encounters/encounter-phase-utils";
import { PokemonPhase } from "#phases/pokemon-phase";
import { applyEffects, resolveItemThunk } from "#system/llm-director/consequence-effects";
import { logEffectApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";

export class VictoryPhase extends PokemonPhase {
  public readonly phaseName = "VictoryPhase";
  /** If true, indicates that the phase is intended for EXP purposes only, and not to continue a battle to next phase */
  isExpOnly: boolean;

  constructor(battlerIndex: BattlerIndex | number, isExpOnly = false) {
    super(battlerIndex);

    this.isExpOnly = isExpOnly;
  }

  start() {
    super.start();

    const isMysteryEncounter = globalScene.currentBattle.isBattleMysteryEncounter();

    // update Pokemon defeated count except for MEs that disable it
    if (!isMysteryEncounter || !globalScene.currentBattle.mysteryEncounter?.preventGameStatsUpdates) {
      globalScene.gameData.gameStats.pokemonDefeated++;
    }

    const expValue = this.getPokemon().getExpValue();
    globalScene.applyPartyExp(expValue, true);

    if (isMysteryEncounter) {
      handleMysteryEncounterVictory(false, this.isExpOnly);
      return this.end();
    }

    if (
      !globalScene
        .getEnemyParty()
        .find(p => (globalScene.currentBattle.battleType === BattleType.WILD ? p.isOnField() : !p?.isFainted(true)))
    ) {
      globalScene.phaseManager.pushNew("BattleEndPhase", true);
      if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
        globalScene.phaseManager.pushNew("TrainerVictoryPhase");
      }

      const gameMode = globalScene.gameMode;
      const currentWaveIndex = globalScene.currentBattle.waveIndex;

      // LLM Director post-victory hook: queue the LLM-authored postWinText +
      // victoryEffects narration + victoryRewards BEFORE the vanilla
      // egg/modifier rewards. Applies only in Director mode and only if the
      // beat that authored this wave actually emitted a hook.
      if (gameMode.modeId === GameModes.LLM_DIRECTOR) {
        applyPostVictoryHook(currentWaveIndex);
      }

      if (gameMode.isEndless || !gameMode.isWaveFinal(currentWaveIndex)) {
        globalScene.phaseManager.pushNew("EggLapsePhase");
        if (gameMode.isClassic) {
          switch (currentWaveIndex) {
            case ClassicFixedBossWaves.RIVAL_1:
            case ClassicFixedBossWaves.RIVAL_2:
              // Get event modifiers for this wave
              timedEventManager
                .getFixedBattleEventRewards(currentWaveIndex)
                .map(r => globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes[r]));
              break;
            case ClassicFixedBossWaves.EVIL_BOSS_2:
              // Should get Lock Capsule on 165 before shop phase so it can be used in the rewards shop
              globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.LOCK_CAPSULE);
              break;
          }
        }
        if (currentWaveIndex % 10) {
          globalScene.phaseManager.pushNew(
            "SelectModifierPhase",
            undefined,
            undefined,
            gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings,
          );
        } else if (gameMode.isDaily) {
          globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_CHARM);
          if (currentWaveIndex > 10 && !gameMode.isWaveFinal(currentWaveIndex)) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.GOLDEN_POKEBALL);
          }
        } else {
          const superExpWave = gameMode.isEndless ? 10 : globalScene.offsetGym ? 0 : 20;
          if (gameMode.isEndless && currentWaveIndex === 10) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_SHARE);
          }
          if (gameMode.isClassic && currentWaveIndex === 10) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_CHARM);
          }
          if (currentWaveIndex <= 750 && (currentWaveIndex <= 500 || currentWaveIndex % 30 === superExpWave)) {
            globalScene.phaseManager.pushNew(
              "ModifierRewardPhase",
              currentWaveIndex % 30 !== superExpWave || currentWaveIndex > 250
                ? modifierTypes.EXP_CHARM
                : modifierTypes.SUPER_EXP_CHARM,
            );
          }
          if (currentWaveIndex <= 150 && !(currentWaveIndex % 50)) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.GOLDEN_POKEBALL);
          }
          if (gameMode.isEndless && !(currentWaveIndex % 50)) {
            globalScene.phaseManager.pushNew(
              "ModifierRewardPhase",
              currentWaveIndex % 250 ? modifierTypes.VOUCHER_PLUS : modifierTypes.VOUCHER_PREMIUM,
            );
            globalScene.phaseManager.pushNew("AddEnemyBuffModifierPhase");
          }
        }

        if (gameMode.hasRandomBiomes || globalScene.isNewBiome()) {
          globalScene.phaseManager.pushNew("SelectBiomePhase");
        }

        globalScene.phaseManager.pushNew("NewBattlePhase");
      } else {
        globalScene.currentBattle.battleType = BattleType.CLEAR;
        globalScene.score += gameMode.getClearScoreBonus();
        globalScene.updateScoreText();
        globalScene.phaseManager.pushNew("GameOverPhase", true);
      }
    }

    this.end();
  }
}

/**
 * Consume the LLM Director post-battle hook for `wave` and queue its
 * narration + effects + rewards. Mirrors `grantConsequenceRewards` from
 * llm-director-beat-phase.ts but for the post-victory case.
 *
 * Phase ordering (each pushNew appends to the queue):
 *   1. MessagePhase: postWinText + victoryEffects narration (one $-paginated msg)
 *   2. ModifierRewardPhase × N: one per victoryRewards item (× qty)
 *
 * Defeat-side hook (postLossText, defeatEffects) lives on FaintPhase / GameOverPhase.
 */
function applyPostVictoryHook(waveIndex: number): void {
  const runtime = getDirectorRuntime();
  if (!runtime) {
    return;
  }
  const hook = runtime.queue.takePostBattleHook(waveIndex);
  if (!hook) {
    return;
  }

  // 1. Apply effects (mutates state, returns narrative strings) +
  //    consolidate with postWinText into one message.
  const tail: string[] = [];
  if (hook.postWinText) {
    tail.push(hook.postWinText);
  }
  if (hook.victoryEffects && hook.victoryEffects.length > 0) {
    try {
      tail.push(...applyEffects(hook.victoryEffects));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logEffectApplied(`victory-wave-${waveIndex}`, "victory-effects-batch", false, reason);
    }
  }
  if (tail.length > 0) {
    const cleaned = tail.map(p => (p ?? "").trim()).filter(p => p.length > 0);
    if (cleaned.length > 0) {
      void globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.phaseManager.pushNew("MessagePhase", cleaned.join("$"), null, true);
    }
  }

  // 2. LLM-authored victoryRewards: each is a ModifierType id (e.g. "POTION").
  if (hook.victoryRewards && hook.victoryRewards.length > 0) {
    const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
    for (const item of hook.victoryRewards) {
      const factory = factories[item.modifierType];
      if (typeof factory !== "function") {
        console.warn(`[llm-director] unknown modifierType in victoryRewards: "${item.modifierType}"`);
        continue;
      }
      const resolved = resolveItemThunk(factory, item.modifierType);
      if (!resolved) {
        continue;
      }
      const qty = Math.max(1, item.qty ?? 1);
      for (let i = 0; i < qty; i++) {
        globalScene.phaseManager.pushNew("ModifierRewardPhase", resolved);
      }
    }
  }

  console.info(
    `[llm-director] post-victory-hook applied wave=${waveIndex} postWinTextLen=${hook.postWinText?.length ?? 0} effects=${hook.victoryEffects?.length ?? 0} rewards=${hook.victoryRewards?.length ?? 0}`,
  );
}

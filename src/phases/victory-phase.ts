import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { erBiomeOverstay } from "#data/elite-redux/er-biome-notoriety";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { erShouldRaiseCrossroads } from "#data/elite-redux/er-biome-structure";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { type ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { generateModifierType, handleMysteryEncounterVictory } from "#mystery-encounters/encounter-phase-utils";
import { PokemonPhase } from "#phases/pokemon-phase";
import { applyEffects } from "#system/llm-director/consequence-effects";
import { logEffectApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { paginateAndJoin } from "#system/llm-director/text-pagination";

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

        // ER #440: Biome Market on x0 boss waves. Vanilla skips
        // SelectModifierPhase entirely on x0 waves (the `if (currentWaveIndex %
        // 10)` above is false), so no shop ever opened. Push the bespoke
        // BiomeShopPhase here - a full-screen 4x4 biome market (see
        // BiomeShopUiHandler) built from getPlayerShopModifierTypeOptionsForWave's
        // 16-slot biome stock. It runs AFTER the x0 reward popups and BEFORE the
        // biome change, so prices reflect the biome just cleared. Shipped to
        // production (release approval): runs on every x0 wave; daily runs
        // (shared seed) are still skipped.
        // ER (#504): the shop cadence stays on the every-10 GLOBAL-wave tick
        // (waveIndex % 10) for ALL runs, including the World Map gate. #486 had
        // moved it to the biome BOUNDARY (isNewBiome); that is reverted here so the
        // market always fires every 10 global waves regardless of variable biome
        // length / notoriety. Daily runs (shared seed) are still skipped.
        const erRouting = erBiomeRoutingActive();
        const biomeEnding = globalScene.isNewBiome();
        const fireBiomeShop = !(currentWaveIndex % 10) && !gameMode.isDaily;
        if (fireBiomeShop) {
          // ER Abyss: the Abyss has no market - its every-10-waves "shop" slot is
          // meant to be Giratina's Bargain (a dialogue event, see TheBargainPhase).
          // The bargain SCREEN is still being polished (#544: the dedicated handler
          // doesn't render in-game yet), so it is GATED to staging/dev only. In
          // production the Abyss x0 slot falls back to the normal market, which is a
          // no-op in the Abyss (noShop) - i.e. the pre-Giratina behavior - so live
          // players never hit the unfinished event. Remove the gate once it ships.
          const env = import.meta.env as unknown as Record<string, unknown>;
          const bargainStagingOnly = !!env.DEV || env.VITE_DEV_TOOLS === "1";
          if (globalScene.arena.biomeId === BiomeId.ABYSS && bargainStagingOnly) {
            globalScene.phaseManager.pushNew("TheBargainPhase");
          } else {
            globalScene.phaseManager.pushNew("BiomeShopPhase");
          }
        }

        // ER (#504): every 10 GLOBAL waves the player also gets a full rest, the
        // same cadence as the biome shop. Vanilla healed on the biome change
        // (SelectBiomePhase, which lined up with every 10 waves); with variable
        // biome length a x0 wave is often MID-biome, so heal here on those mid-biome
        // x0 waves. Biome-change waves (biomeEnding) still heal via SelectBiomePhase,
        // so the !biomeEnding guard avoids a double heal. ER routing only (in vanilla
        // a x0 wave is always the biome change, so nothing changes there).
        if (erRouting && fireBiomeShop && !biomeEnding) {
          globalScene.phaseManager.pushNew("PartyHealPhase", false);
        }

        if (gameMode.hasRandomBiomes || biomeEnding) {
          globalScene.phaseManager.pushNew("SelectBiomePhase");
        } else if (
          erRouting
          && erShouldRaiseCrossroads(currentWaveIndex)
          && !gameMode.isFixedBattle(currentWaveIndex + 1)
        ) {
          // ER (#486): not a biome end, but a 5-wave Crossroads tick - raise the
          // "Stay / Move on" choice AFTER the reward and BEFORE the next battle.
          globalScene.phaseManager.pushNew("ErCrossroadsPhase");
        }

        // ER (#504): warn ONCE, exactly on the wave the player crosses into
        // notoriety (the next wave is the FIRST past the 10-wave free window) and
        // the biome is NOT ending. Gated on the overstay TRANSITION (== 1) rather
        // than a module-state latch, so a mid-biome save/state restore can't make
        // it re-fire every wave (the old erClaimNotorietyWarning latch bug).
        if (erRouting && !biomeEnding && erBiomeOverstay(currentWaveIndex + 1) === 1) {
          globalScene.phaseManager.pushNew(
            "MessagePhase",
            "Word of your lingering has spread, and you are gaining notoriety here. The longer you stay, the more hostile this place will grow.",
            null,
            true,
          );
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
    const combined = paginateAndJoin(tail);
    if (combined.length > 0) {
      void globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.phaseManager.pushNew("MessagePhase", combined, null, true);
    }
  }

  // 2. LLM-authored victoryRewards: bundle into a single SelectModifierPhase
  // so the player picks ONE from the row. Pokemon-targeted modifiers
  // (POTION, LEFTOVERS, etc.) need the shop's target-selection step
  // anyway — and bundling everything into one shop avoids the empty-name +
  // freeze bugs from per-item ModifierRewardPhase. Same dedupe + qty=1 cap
  // as grantConsequenceRewards: the shop is a chooser, not a stockpile.
  if (hook.victoryRewards && hook.victoryRewards.length > 0) {
    const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
    const guaranteed: ModifierTypeOption[] = [];
    const seen = new Set<string>();
    for (const item of hook.victoryRewards) {
      if (seen.has(item.modifierType)) {
        continue;
      }
      seen.add(item.modifierType);
      const factory = factories[item.modifierType];
      if (typeof factory !== "function") {
        console.warn(`[llm-director] unknown modifierType in victoryRewards: "${item.modifierType}"`);
        continue;
      }
      const resolved = generateModifierType(factory);
      if (!resolved) {
        console.warn(`[llm-director] victoryRewards "${item.modifierType}" produced no compatible item — skipping`);
        continue;
      }
      guaranteed.push(new ModifierTypeOption(resolved, 0));
    }
    if (guaranteed.length > 0) {
      globalScene.phaseManager.pushNew("SelectModifierPhase", 0, undefined, {
        guaranteedModifierTypeOptions: guaranteed,
        fillRemaining: false,
        rerollMultiplier: 0,
      });
    }
  }

  console.info(
    `[llm-director] post-victory-hook applied wave=${waveIndex} postWinTextLen=${hook.postWinText?.length ?? 0} effects=${hook.victoryEffects?.length ?? 0} rewards=${hook.victoryRewards?.length ?? 0}`,
  );
}

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import {
  captureCoopTrainerVictoryBoundary,
  clearCoopTrainerVictoryBoundary,
  getCoopTrainerVictoryBoundary,
} from "#data/elite-redux/coop/coop-trainer-victory-boundary";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { TrainerType } from "#enums/trainer-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { describe, expect, it } from "vitest";

function scene(biomeId = BiomeId.TOWN): BattleScene {
  return { arena: { biomeId } } as BattleScene;
}

function trainerBattle(wave: number, trainerType: TrainerType, reward: ModifierTypeFunc, name: string): Battle {
  return {
    waveIndex: wave,
    battleType: BattleType.TRAINER,
    trainer: {
      config: {
        trainerType,
        moneyMultiplier: wave,
        modifierRewardFuncs: [reward],
        isBoss: false,
        hasCharSprite: true,
        victoryBgm: `victory-${wave}`,
      },
      getKey: () => `trainer-${trainerType}`,
      getName: () => name,
      getVictoryMessages: () => [`defeated-${wave}`],
    },
  } as unknown as Battle;
}

describe("co-op retained trainer-victory boundary", () => {
  it("keeps exact source-wave trainer rewards after the ambient battle advances", () => {
    const renderer = scene(BiomeId.SPACE);
    const reward = (() => ({ id: "exact-wave-8" })) as unknown as ModifierTypeFunc;
    const source = trainerBattle(8, TrainerType.RIVAL, reward, "Rival Ivy");

    const captured = captureCoopTrainerVictoryBoundary(renderer, source);
    expect(captured?.sourceWave).toBe(8);
    expect(captured?.trainerType).toBe(TrainerType.RIVAL);
    expect(captured?.trainerName).toBe("Rival Ivy");
    expect(captured?.biomeId).toBe(BiomeId.SPACE);

    // Model the gate failure: currentBattle is now a wild wave 9. The exact retained lookup must still
    // return wave 8 and must never substitute a newest/ambient boundary for another address.
    expect(getCoopTrainerVictoryBoundary(renderer, 8)?.modifierRewardFuncs).toEqual([reward]);
    expect(getCoopTrainerVictoryBoundary(renderer, 9)).toBeNull();
    expect(Object.isFrozen(getCoopTrainerVictoryBoundary(renderer, 8))).toBe(true);
    expect(Object.isFrozen(getCoopTrainerVictoryBoundary(renderer, 8)?.modifierRewardFuncs)).toBe(true);

    clearCoopTrainerVictoryBoundary(renderer, 8);
    expect(getCoopTrainerVictoryBoundary(renderer, 8)).toBeNull();
  });

  it("isolates renderer scenes and bounds unconsumed source-wave history", () => {
    const firstRenderer = scene();
    const secondRenderer = scene();
    const firstReward = (() => ({ id: "first" })) as unknown as ModifierTypeFunc;
    const secondReward = (() => ({ id: "second" })) as unknown as ModifierTypeFunc;

    captureCoopTrainerVictoryBoundary(firstRenderer, trainerBattle(8, TrainerType.RIVAL, firstReward, "Ivy"));
    captureCoopTrainerVictoryBoundary(secondRenderer, trainerBattle(8, TrainerType.BREEDER, secondReward, "Ada"));
    expect(getCoopTrainerVictoryBoundary(firstRenderer, 8)?.trainerType).toBe(TrainerType.RIVAL);
    expect(getCoopTrainerVictoryBoundary(secondRenderer, 8)?.trainerType).toBe(TrainerType.BREEDER);

    for (let wave = 9; wave <= 13; wave++) {
      captureCoopTrainerVictoryBoundary(
        firstRenderer,
        trainerBattle(wave, TrainerType.RIVAL, firstReward, `Ivy ${wave}`),
      );
    }
    expect(getCoopTrainerVictoryBoundary(firstRenderer, 8), "the oldest unconsumed context is evicted").toBeNull();
    expect(getCoopTrainerVictoryBoundary(firstRenderer, 10)).not.toBeNull();
    expect(getCoopTrainerVictoryBoundary(firstRenderer, 13)).not.toBeNull();
    expect(getCoopTrainerVictoryBoundary(secondRenderer, 8)?.modifierRewardFuncs).toEqual([secondReward]);

    for (let wave = 8; wave <= 13; wave++) {
      clearCoopTrainerVictoryBoundary(firstRenderer, wave);
      clearCoopTrainerVictoryBoundary(secondRenderer, wave);
    }
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import {
  captureCoopTrainerVictoryBoundary,
  captureCoopTrainerVictoryMaterial,
  clearCoopTrainerVictoryBoundary,
  getCoopTrainerVictoryBoundary,
  installCoopTrainerVictoryMaterial,
} from "#data/elite-redux/coop/coop-trainer-victory-boundary";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { TrainerType } from "#enums/trainer-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { describe, expect, it } from "vitest";

function scene(biomeId: BiomeId = BiomeId.TOWN): BattleScene {
  return { arena: { biomeId } } as BattleScene;
}

function trainerBattle(
  wave: number,
  trainerType: TrainerType,
  rewards: ModifierTypeFunc | readonly ModifierTypeFunc[],
  name: string,
): Battle {
  return {
    waveIndex: wave,
    battleType: BattleType.TRAINER,
    trainer: {
      config: {
        trainerType,
        moneyMultiplier: wave,
        modifierRewardFuncs: typeof rewards === "function" ? [rewards] : [...rewards],
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
  it("round-trips immutable trainer material without consulting the renderer battle", () => {
    const authority = scene(BiomeId.FOREST);
    const renderer = scene(BiomeId.TOWN);
    const source = trainerBattle(6, TrainerType.ACE_TRAINER, modifierTypes.VOUCHER, "Ace Trilo");

    const material = captureCoopTrainerVictoryMaterial(authority, source);
    expect(material).toMatchObject({
      sourceWave: 6,
      trainerType: TrainerType.ACE_TRAINER,
      modifierRewardTypeIds: ["VOUCHER"],
      trainerName: "Ace Trilo",
      biomeId: BiomeId.FOREST,
    });
    expect(Object.isFrozen(material)).toBe(true);
    expect(Object.isFrozen(material?.modifierRewardTypeIds)).toBe(true);

    const installed = installCoopTrainerVictoryMaterial(renderer, structuredClone(material!));
    expect(installed?.sourceWave).toBe(6);
    expect(installed?.trainerName).toBe("Ace Trilo");
    expect(installed?.biomeId).toBe(BiomeId.FOREST);
    expect(installed?.modifierRewardFuncs).toEqual([modifierTypes.VOUCHER]);
    expect(getCoopTrainerVictoryBoundary(renderer, 6)).toBe(installed);

    clearCoopTrainerVictoryBoundary(renderer, 6);

    const malformed = { ...structuredClone(material!), modifierRewardTypeIds: ["NOT_A_REGISTERED_REWARD"] };
    expect(installCoopTrainerVictoryMaterial(renderer, malformed)).toBeNull();
    expect(
      getCoopTrainerVictoryBoundary(renderer, 6),
      "a rejected material image cannot leak into the ledger",
    ).toBeNull();
  });

  it("round-trips the first Rival's complete two-reward material", () => {
    const authority = scene(BiomeId.TOWN);
    const renderer = scene(BiomeId.TOWN);
    const source = trainerBattle(
      8,
      TrainerType.RIVAL,
      [modifierTypes.SUPER_EXP_CHARM, modifierTypes.EXP_SHARE],
      "Rival Ivy",
    );

    const material = captureCoopTrainerVictoryMaterial(authority, source);
    expect(material?.modifierRewardTypeIds).toEqual(["SUPER_EXP_CHARM", "EXP_SHARE"]);

    const installed = installCoopTrainerVictoryMaterial(renderer, structuredClone(material!));
    expect(installed?.trainerType).toBe(TrainerType.RIVAL);
    expect(installed?.modifierRewardFuncs).toEqual([modifierTypes.SUPER_EXP_CHARM, modifierTypes.EXP_SHARE]);

    clearCoopTrainerVictoryBoundary(renderer, 8);
  });

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

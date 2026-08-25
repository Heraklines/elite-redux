/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { allAbilities, allMoves } from "#data/data-lists";
import { ER_OMNIFORM_COMPOSITE_PART_ID, MANUAL_COMPOSITE_PARTS } from "#data/elite-redux/abilities/composite-newcomers";
import {
  applyFunMegaStatDelta,
  formatFunMegaMixEffects,
  formatFunMegaStatDelta,
  getFunEnemyMegaChance,
  getFunMegaMixEffects,
  getFunMegaStoneMetadata,
  isFunPseudoMegaActive,
  shuffleFunStats,
} from "#data/elite-redux/er-fun-mega-mode";
import {
  DEFAULT_FUN_MODE_CONFIG,
  extendEndlessAbilityAvalancheIds,
  getEndlessAbilityAvalancheIds,
  getFunAbilityAvalancheCount,
  getFunAbilityAvalancheIds,
  getFunEvolutionTarget,
  getFunModeConfig,
  getFunRandomAbilityId,
  getFunRandomLevelMoves,
  getFunRandomTypes,
  getFunScrambledMoveId,
  isFunRandomAbilityEligible,
  rerollFunAbilities,
  resetFunModeConfig,
  rollFunTerrain,
  rollFunWeather,
  setFunModeConfig,
  shouldGrantFunCaptureProgress,
} from "#data/elite-redux/er-fun-mode";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import type { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { loadLastFunModeConfig, saveLastFunModeConfig } from "#utils/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  Phaser.Math.RND = new Phaser.Math.RandomDataGenerator(["er-fun-mode-test"]);
});

afterEach(() => {
  resetFunModeConfig();
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith("lastFunMode_")) {
      localStorage.removeItem(key);
    }
  }
});

describe("Fun Mode configuration", () => {
  it("starts fresh runs with every modifier disabled", () => {
    expect(DEFAULT_FUN_MODE_CONFIG).toMatchObject({
      difficulty: "youngster",
      debugMode: false,
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      megaMode: false,
      megaMixMode: false,
      shuffleStats: false,
      shuffleEvolutions: false,
      itemChaos: false,
      weatherRoulette: false,
      scrambleMoves: false,
      abilityAvalanche: false,
      moodyMode: false,
    });
  });

  it("is a 200-wave classic-style run with no leaderboard determinism", () => {
    const mode = getGameMode(GameModes.FUN);
    expect(mode.isFun).toBe(true);
    expect(mode.isClassic).toBe(true);
    expect(mode.nonDeterministic).toBe(true);
    expect(mode.isWaveFinal(199)).toBe(false);
    expect(mode.isWaveFinal(200)).toBe(true);
  });

  it("stores independent randomizer toggles", () => {
    setFunModeConfig({
      difficulty: "hell",
      debugMode: true,
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: false,
      randomizeLevelUpMoves: true,
      megaMode: true,
      megaMixMode: true,
      shuffleStats: true,
      shuffleEvolutions: true,
      itemChaos: true,
      weatherRoulette: true,
      scrambleMoves: true,
      abilityAvalanche: true,
      moodyMode: false,
      abilityRerollSeed: 4,
    });
    expect(getFunModeConfig()).toEqual({
      difficulty: "hell",
      debugMode: true,
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: false,
      randomizeLevelUpMoves: true,
      megaMode: true,
      megaMixMode: true,
      shuffleStats: true,
      shuffleEvolutions: true,
      itemChaos: true,
      weatherRoulette: true,
      scrambleMoves: true,
      abilityAvalanche: true,
      moodyMode: false,
      abilityRerollSeed: 4,
    });
  });

  it("persists the last modifier setup without carrying over its reroll seed", () => {
    const config = {
      difficulty: "hell" as const,
      debugMode: true,
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: true,
      randomizeLevelUpMoves: false,
      megaMode: true,
      megaMixMode: true,
      shuffleStats: true,
      shuffleEvolutions: true,
      itemChaos: true,
      weatherRoulette: true,
      scrambleMoves: true,
      abilityAvalanche: true,
      moodyMode: false,
      abilityRerollSeed: 27,
    };
    saveLastFunModeConfig(config);
    expect(loadLastFunModeConfig()).toEqual({
      difficulty: "hell",
      debugMode: true,
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: true,
      randomizeLevelUpMoves: false,
      megaMode: true,
      megaMixMode: true,
      shuffleStats: true,
      shuffleEvolutions: true,
      itemChaos: true,
      weatherRoulette: true,
      scrambleMoves: true,
      abilityAvalanche: true,
      moodyMode: false,
    });
  });

  it("loads legacy six-toggle setups with every newer modifier disabled", () => {
    saveLastFunModeConfig(DEFAULT_FUN_MODE_CONFIG);
    const storageKey = localStorage.key(0);
    expect(storageKey).not.toBeNull();
    localStorage.setItem(
      storageKey!,
      JSON.stringify({
        randomizePokemon: true,
        randomizeTypes: false,
        randomizeAbilities: true,
        randomizeLevelUpMoves: false,
        megaMode: true,
        shuffleStats: false,
      }),
    );
    expect(loadLastFunModeConfig()).toMatchObject({
      difficulty: "youngster",
      debugMode: false,
      randomizePokemon: true,
      randomizeTypes: false,
      randomizeAbilities: true,
      randomizeLevelUpMoves: false,
      megaMode: true,
      megaMixMode: false,
      shuffleStats: false,
      shuffleEvolutions: false,
      itemChaos: false,
      weatherRoulette: false,
      scrambleMoves: false,
      abilityAvalanche: false,
      moodyMode: false,
    });
  });

  it("suppresses permanent capture progress for randomized species and Item Chaos shinies", () => {
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, randomizePokemon: true });
    expect(shouldGrantFunCaptureProgress(false)).toBe(false);
    expect(shouldGrantFunCaptureProgress(true)).toBe(false);

    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, itemChaos: true });
    expect(shouldGrantFunCaptureProgress(false)).toBe(true);
    expect(shouldGrantFunCaptureProgress(true)).toBe(false);

    setFunModeConfig(DEFAULT_FUN_MODE_CONFIG);
    expect(shouldGrantFunCaptureProgress(false)).toBe(true);
    expect(shouldGrantFunCaptureProgress(true)).toBe(true);

    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, debugMode: true });
    expect(shouldGrantFunCaptureProgress(false)).toBe(false);
    expect(shouldGrantFunCaptureProgress(true)).toBe(false);
  });
});

describe("Fun Mode deterministic per-Pokemon randomization", () => {
  it("keeps a stable, duplicate-free native type count", () => {
    const first = getFunRandomTypes(12345, [PokemonType.FIRE, PokemonType.FLYING]);
    const second = getFunRandomTypes(12345, [PokemonType.FIRE, PokemonType.FLYING]);
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(2);
  });

  it("selects only implemented abilities", () => {
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, randomizeAbilities: true });
    const ids = new Set();
    for (let slot = 0; slot < 6; slot++) {
      const id = getFunRandomAbilityId(12345, slot);
      expect(id).not.toBeNull();
      expect(allAbilities[id!].unimplemented).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(6);
  });

  it("excludes Omniform and every Omniform composite from random abilities and Avalanche", () => {
    const omniformAbilities = [
      ER_OMNIFORM_COMPOSITE_PART_ID,
      ...Object.entries(MANUAL_COMPOSITE_PARTS)
        .filter(([, def]) => def.constituents.includes(ER_OMNIFORM_COMPOSITE_PART_ID))
        .map(([abilityId]) => Number(abilityId)),
    ] as AbilityId[];

    expect(omniformAbilities.length).toBeGreaterThan(1);
    for (const abilityId of omniformAbilities) {
      expect(isFunRandomAbilityEligible(abilityId)).toBe(false);
    }

    setFunModeConfig({ ...getFunModeConfig(), abilityAvalanche: true });
    for (let pokemonId = 1; pokemonId <= 200; pokemonId++) {
      for (let slot = 0; slot < 6; slot++) {
        expect(omniformAbilities).not.toContain(getFunRandomAbilityId(pokemonId, slot));
      }
      expect(getFunAbilityAvalancheIds(pokemonId, 200)).not.toEqual(expect.arrayContaining(omniformAbilities));
    }
  });

  it("rerolls the whole party seed without destabilizing the selected result", () => {
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, randomizeAbilities: true });
    const slots = [0, 1, 2, 3, 4, 5];
    const before = slots.map(slot => getFunRandomAbilityId(12345, slot));
    rerollFunAbilities();
    const after = slots.map(slot => getFunRandomAbilityId(12345, slot));
    expect(after).not.toEqual(before);
    expect(slots.map(slot => getFunRandomAbilityId(12345, slot))).toEqual(after);
  });

  it("adds prefix-stable, duplicate-free Avalanche abilities every 20 waves from wave 60", () => {
    setFunModeConfig({ ...getFunModeConfig(), abilityAvalanche: true });
    expect([59, 60, 79, 80, 100].map(getFunAbilityAvalancheCount)).toEqual([0, 1, 1, 2, 3]);
    const excluded = [allAbilities[1].id, allAbilities[2].id];
    const wave60 = getFunAbilityAvalancheIds(12345, 60, excluded);
    const wave100 = getFunAbilityAvalancheIds(12345, 100, excluded);
    expect(wave60).toHaveLength(1);
    expect(wave100).toHaveLength(3);
    expect(wave100.slice(0, wave60.length)).toEqual(wave60);
    expect(new Set(wave100).size).toBe(wave100.length);
    expect(wave100.some(abilityId => excluded.includes(abilityId))).toBe(false);
    for (const abilityId of wave100) {
      expect(allAbilities[abilityId].unimplemented).toBe(false);
    }
  });

  it("caches Endless Avalanche selections without exposing mutable cache state", () => {
    const excluded = [allAbilities[1].id, allAbilities[2].id];
    const first = getEndlessAbilityAvalancheIds(0xa11a0002, 12, excluded, 99);
    expect(first).toHaveLength(12);
    expect(new Set(first).size).toBe(12);
    expect(first.some(abilityId => excluded.includes(abilityId))).toBe(false);

    first.pop();
    expect(getEndlessAbilityAvalancheIds(0xa11a0002, 12, [...excluded].reverse(), 99)).toHaveLength(12);
  });

  it("appends newly earned Endless Avalanche abilities without rerolling existing slots", () => {
    const initialExcluded = [allAbilities[1].id, allAbilities[2].id];
    const first = extendEndlessAbilityAvalancheIds(0xa11a0003, 3, [], initialExcluded);
    const changedBattleExclusions = [allAbilities[3].id, allAbilities[4].id, allAbilities[5].id];
    const later = extendEndlessAbilityAvalancheIds(0xa11a0003, 5, first, changedBattleExclusions, 99);

    expect(first).toHaveLength(3);
    expect(later).toHaveLength(5);
    expect(later.slice(0, first.length)).toEqual(first);
    expect(new Set(later).size).toBe(later.length);
    expect(extendEndlessAbilityAvalancheIds(0xa11a0003, 5, later, [], 12345)).toEqual(later);
  });

  it("serializes each Pokemon's canonical Endless Avalanche sequence", () => {
    const original = new CustomPokemonData();
    original.erEndlessAvalancheAbilities = [allAbilities[1].id, allAbilities[2].id];

    const restored = new CustomPokemonData(JSON.parse(JSON.stringify(original)));
    expect(restored.erEndlessAvalancheAbilities).toEqual(original.erEndlessAvalancheAbilities);
    restored.erEndlessAvalancheAbilities.pop();
    expect(original.erEndlessAvalancheAbilities).toHaveLength(2);
  });

  it("retains learn levels while excluding unavailable moves", () => {
    const source: LevelMoves = [
      [1, MoveId.TACKLE],
      [5, MoveId.GROWL],
      [9, MoveId.QUICK_ATTACK],
      [14, MoveId.BITE],
    ];
    const randomized = getFunRandomLevelMoves(67890, source);
    expect(randomized.map(([level]) => level)).toEqual(source.map(([level]) => level));
    expect(randomized.map(([, move]) => move)).toEqual(getFunRandomLevelMoves(67890, source).map(([, move]) => move));
    expect(new Set(randomized.map(([, move]) => move)).size).toBe(randomized.length);
    for (const [, moveId] of randomized) {
      expect(moveId).not.toBe(MoveId.STRUGGLE);
      expect(allMoves[moveId].isUnimplemented).toBe(false);
    }
  });

  it("replaces a used moveset slot with a stable implemented move not already known", () => {
    setFunModeConfig({ ...getFunModeConfig(), scrambleMoves: true });
    const current = [MoveId.TACKLE, MoveId.GROWL, MoveId.QUICK_ATTACK, MoveId.BITE];
    const replacement = getFunScrambledMoveId(12345, MoveId.TACKLE, 20, 3, current);
    expect(replacement).not.toBeNull();
    expect(current).not.toContain(replacement);
    expect(allMoves[replacement!].isUnimplemented).toBe(false);
    expect(allMoves[replacement!].category).not.toBe(MoveCategory.STATUS);
    expect(getFunScrambledMoveId(12345, MoveId.TACKLE, 20, 3, current)).toBe(replacement);

    const statusMove = allMoves.find(move => move?.category === MoveCategory.STATUS && !move.isUnimplemented);
    expect(statusMove).toBeDefined();
    const statusReplacement = getFunScrambledMoveId(12345, statusMove!.id, 20, 3, current);
    expect(statusReplacement).not.toBeNull();
    expect(allMoves[statusReplacement!].category).toBe(MoveCategory.STATUS);
  });

  it("selects a stable obtainable evolution target distinct from the current species", () => {
    setFunModeConfig({ ...getFunModeConfig(), shuffleEvolutions: true });
    const target = getFunEvolutionTarget(12345, 1, 0);
    expect(target).not.toBeNull();
    expect(target!.species.speciesId).not.toBe(1);
    expect(target!.formIndex === 0 || target!.species.forms[target!.formIndex].isStarterSelectable).toBe(true);
    expect(getFunEvolutionTarget(12345, 1, 0)).toEqual(target);
  });

  it("rolls weather and terrain only when Weather Chaos is enabled", () => {
    expect(rollFunWeather()).toBeNull();
    expect(rollFunTerrain()).toBeNull();
    setFunModeConfig({ ...getFunModeConfig(), weatherRoulette: true });
    expect(rollFunWeather()).not.toBeNull();
    expect(rollFunTerrain()).not.toBeNull();
  });
});

describe("Fun Mega Mode statlines", () => {
  it("shuffles a non-Mega statline whenever Stat Shuffle is selected", () => {
    const base = [45, 49, 49, 65, 65, 45];
    const shuffled = shuffleFunStats(base, 123456);
    expect(shuffled).not.toEqual(base);
    expect(shuffled.reduce((total, value) => total + value, 0)).toBe(base.reduce((total, value) => total + value, 0));
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...base].sort((a, b) => a - b));
  });

  it("derives a stone delta from the real source and Mega forms", () => {
    const metadata = getFunMegaStoneMetadata(FormChangeItem.SWAMPERTITE);
    expect(metadata).not.toBeNull();
    expect(metadata!.statDelta.reduce((total, value) => total + value, 0)).toBe(100);
    expect(formatFunMegaStatDelta(FormChangeItem.SWAMPERTITE)).toContain("Atk+40");
  });

  it("derives Full Mix type and innate overlays from the Mega template", () => {
    const metadata = getFunMegaStoneMetadata(FormChangeItem.SWAMPERTITE);
    const effects = getFunMegaMixEffects(FormChangeItem.SWAMPERTITE);
    expect(metadata).not.toBeNull();
    expect(effects).not.toBeNull();
    expect(metadata!.mixTypeCandidates).toContain(effects!.addedType);
    expect(effects!.innate1).toBe(metadata!.innateOverrides[0]);
    expect(effects!.innate3).toBe(metadata!.innateOverrides[1]);
    expect(formatFunMegaMixEffects(FormChangeItem.SWAMPERTITE)).toContain("I1 Riptide");
  });

  it("does not add a duplicate type when the recipient already has every Mega template type", () => {
    const metadata = getFunMegaStoneMetadata(FormChangeItem.SWAMPERTITE)!;
    expect(getFunMegaMixEffects(FormChangeItem.SWAMPERTITE, metadata.mixTypeCandidates)?.addedType).toBeNull();
  });

  it("applies a pseudo-Mega delta before deterministically shuffling the effective line", () => {
    const base = [80, 80, 80, 80, 80, 80];
    const effective = applyFunMegaStatDelta(base, FormChangeItem.SWAMPERTITE);
    const shuffled = shuffleFunStats(effective, 123456, FormChangeItem.SWAMPERTITE);
    expect(shuffled.reduce((total, value) => total + value, 0)).toBe(
      effective.reduce((total, value) => total + value, 0),
    );
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...effective].sort((a, b) => a - b));
    expect(shuffleFunStats(effective, 123456, FormChangeItem.SWAMPERTITE)).toEqual(shuffled);
  });

  it("persists the temporary pseudo-Mega record through CustomPokemonData", () => {
    const restored = new CustomPokemonData(
      new CustomPokemonData({ erFunMegaStone: FormChangeItem.SWAMPERTITE, erFunPseudoMega: true }),
    );
    expect(restored.erFunMegaStone).toBe(FormChangeItem.SWAMPERTITE);
    expect(restored.erFunPseudoMega).toBe(true);
  });

  it("does not activate or mark a pseudo-Mega without its held Mega Stone", () => {
    expect(isFunPseudoMegaActive(true, FormChangeItem.SWAMPERTITE, false)).toBe(false);
    expect(isFunPseudoMegaActive(true, FormChangeItem.SWAMPERTITE, true)).toBe(true);
  });

  it("ramps enemy Mega frequency to certainty at wave 50", () => {
    expect(getFunEnemyMegaChance(1)).toBeCloseTo(0.08);
    expect(getFunEnemyMegaChance(50)).toBe(1);
    expect(getFunEnemyMegaChance(100)).toBe(1);
  });
});

describe("implemented ER move markers and descriptions", () => {
  it.each([
    [MoveId.TRICK, "held items"],
    [MoveId.SWITCHEROO, "held items"],
    [MoveId.MAGIC_ROOM, "passive damage"],
  ] as const)("clears the stale (N) marker for %s and exposes its ER behavior", (moveId, effectText) => {
    const move = allMoves[moveId];
    expect(move.isUnimplemented).toBe(false);
    expect(move.name).not.toContain("(N)");
    expect(move.effect.toLowerCase()).toContain(effectText);
  });

  it.each([
    [1009, "stat changes"],
    [1010, "thundershock storm"],
  ] as const)("clears the imported (N) marker for ER move %s", (erMoveId, effectText) => {
    const move = allMoves[ER_ID_MAP.moves[erMoveId]];
    expect(move.isUnimplemented).toBe(false);
    expect(move.name).not.toContain("(N)");
    expect(move.effect.toLowerCase()).toContain(effectText);
  });

  it("clears Overzealous's imported marker and describes its implemented priority effect", () => {
    const ability = allAbilities[ER_ID_MAP.abilities[828]];
    expect(ability.unimplemented).toBe(false);
    expect(ability.name).toBe("Overzealous");
    expect(ability.description.toLowerCase()).toContain("super-effective");
    expect(ability.description).toContain("+1 priority");
  });
});

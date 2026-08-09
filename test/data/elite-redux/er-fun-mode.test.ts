/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  applyFunMegaStatDelta,
  formatFunMegaStatDelta,
  getFunEnemyMegaChance,
  getFunMegaStoneMetadata,
  shuffleFunStats,
} from "#data/elite-redux/er-fun-mega-mode";
import {
  getFunModeConfig,
  getFunRandomAbilityId,
  getFunRandomLevelMoves,
  getFunRandomTypes,
  rerollFunAbilities,
  resetFunModeConfig,
  setFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { loadLastFunModeConfig, saveLastFunModeConfig } from "#utils/data";
import { afterEach, describe, expect, it } from "vitest";

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
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: false,
      randomizeLevelUpMoves: true,
      megaMode: true,
      shuffleStats: true,
      abilityRerollSeed: 4,
    });
    expect(getFunModeConfig()).toEqual({
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: false,
      randomizeLevelUpMoves: true,
      megaMode: true,
      shuffleStats: true,
      abilityRerollSeed: 4,
    });
  });

  it("persists the last modifier setup without carrying over its reroll seed", () => {
    const config = {
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: true,
      randomizeLevelUpMoves: false,
      megaMode: true,
      shuffleStats: true,
      abilityRerollSeed: 27,
    };
    saveLastFunModeConfig(config);
    expect(loadLastFunModeConfig()).toEqual({
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: true,
      randomizeLevelUpMoves: false,
      megaMode: true,
      shuffleStats: true,
    });
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
    const ids = new Set();
    for (let slot = 0; slot < 6; slot++) {
      const id = getFunRandomAbilityId(12345, slot);
      expect(id).not.toBeNull();
      expect(allAbilities[id!].unimplemented).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(6);
  });

  it("rerolls the whole party seed without destabilizing the selected result", () => {
    const slots = [0, 1, 2, 3, 4, 5];
    const before = slots.map(slot => getFunRandomAbilityId(12345, slot));
    rerollFunAbilities();
    const after = slots.map(slot => getFunRandomAbilityId(12345, slot));
    expect(after).not.toEqual(before);
    expect(slots.map(slot => getFunRandomAbilityId(12345, slot))).toEqual(after);
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
    expect(formatFunMegaStatDelta(FormChangeItem.SWAMPERTITE)).toContain("Atk +40");
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

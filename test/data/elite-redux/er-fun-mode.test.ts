/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  getFunModeConfig,
  getFunRandomAbilityId,
  getFunRandomLevelMoves,
  getFunRandomTypes,
  resetFunModeConfig,
  setFunModeConfig,
} from "#data/elite-redux/er-fun-mode";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => resetFunModeConfig());

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
    });
    expect(getFunModeConfig()).toEqual({
      randomizePokemon: false,
      randomizeTypes: true,
      randomizeAbilities: false,
      randomizeLevelUpMoves: true,
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
    for (let slot = 0; slot < 4; slot++) {
      const id = getFunRandomAbilityId(12345, slot);
      expect(id).not.toBeNull();
      expect(allAbilities[id!].unimplemented).toBe(false);
    }
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

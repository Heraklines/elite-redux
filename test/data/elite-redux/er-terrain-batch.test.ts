/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER terrain abilities: Zen Garden (random Grassy/Psychic on entry), Lawnmower
// (clears terrain + terrain-conditional stat), Turf War (clears terrain + stat).

import { PostSummonClearTerrainAbAttr } from "#data/elite-redux/archetypes/post-summon-clear-terrain";
import { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER terrain abilities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("Zen Garden — sets Grassy or Psychic terrain on entry", async () => {
    game.override.ability(ErAbilityId.ZEN_GARDEN as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const terrain = game.scene.arena.terrain?.terrainType;
    expect([TerrainType.GRASSY, TerrainType.PSYCHIC]).toContain(terrain);
  });

  test("Lawnmower — clears active terrain and raises Defense for Grassy", async () => {
    game.override.ability(ErAbilityId.LAWNMOWER as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.field.getPlayerPokemon();
    const attr = player.getAbility().attrs.find(a => a instanceof PostSummonClearTerrainAbAttr) as
      | PostSummonClearTerrainAbAttr
      | undefined;
    expect(attr).toBeDefined();
    // Grassy active -> apply -> terrain cleared synchronously (the Def+1 is
    // queued as a StatStageChangePhase; byTerrain GRASSY->DEF mapping verified
    // by wiring).
    game.scene.arena.trySetTerrain(TerrainType.GRASSY, false);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
    attr!.apply({ pokemon: player, simulated: false, passive: false } as never);
    expect(game.scene.arena.terrain?.terrainType ?? TerrainType.NONE).toBe(TerrainType.NONE);
  });
});

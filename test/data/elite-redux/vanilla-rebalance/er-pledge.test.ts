/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Pledge moves are reworked: 90 BP, "uses highest attack"
// (PhotonGeyserCategoryAttr), and SINGLE-CAST field effects keyed to weather /
// terrain (no two-Pledge combining). This pins both the static wiring and the
// live weather/terrain behaviour.
// =============================================================================

import { TerrainType } from "#app/data/terrain";
import { allMoves } from "#data/data-lists";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

function getMove(id: MoveId) {
  return allMoves.find(m => m?.id === id)!;
}
function attrNames(id: MoveId): string[] {
  return getMove(id).attrs.map(a => a.constructor.name);
}

describe("ER Pledge — static wiring", () => {
  for (const id of [MoveId.WATER_PLEDGE, MoveId.FIRE_PLEDGE, MoveId.GRASS_PLEDGE]) {
    it(`${MoveId[id]} is 90 BP, highest-attack, single-cast (no combine attrs)`, () => {
      const move = getMove(id);
      expect(move.power).toBe(90);
      const names = attrNames(id);
      expect(names).toContain("ErPledgeWeatherEffectAttr");
      expect(names).toContain("PhotonGeyserCategoryAttr");
      // vanilla two-Pledge combine machinery is gone
      expect(names).not.toContain("AwaitCombinedPledgeAttr");
      expect(names).not.toContain("AddPledgeEffectAttr");
      expect(names).not.toContain("CombinedPledgePowerAttr");
    });
  }

  it("tooltips mention the ER field effects", () => {
    expect(getMove(MoveId.WATER_PLEDGE).effect.toLowerCase()).toContain("rainbow");
    expect(getMove(MoveId.GRASS_PLEDGE).effect.toLowerCase()).toContain("sea of fire");
  });
});

describe("ER Pledge — single-cast weather/terrain effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .moveset(MoveId.WATER_PLEDGE)
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100);
  });

  it("Water Pledge in sun lays a rainbow on the user's side", async () => {
    game.override.weather(WeatherType.SUNNY);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.select(MoveId.WATER_PLEDGE);
    await game.phaseInterceptor.to("BerryPhase");

    expect(game.scene.arena.getTagOnSide(ArenaTagType.WATER_FIRE_PLEDGE, ArenaTagSide.PLAYER)).toBeDefined();
  });

  it("Water Pledge on Grassy Terrain lays a swamp on the foe's side", async () => {
    game.override.startingTerrain(TerrainType.GRASSY);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.select(MoveId.WATER_PLEDGE);
    await game.phaseInterceptor.to("BerryPhase");

    expect(game.scene.arena.getTagOnSide(ArenaTagType.GRASS_WATER_PLEDGE, ArenaTagSide.ENEMY)).toBeDefined();
  });

  it("Water Pledge in clear weather lays no field effect", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.select(MoveId.WATER_PLEDGE);
    await game.phaseInterceptor.to("BerryPhase");

    expect(game.scene.arena.getTagOnSide(ArenaTagType.WATER_FIRE_PLEDGE, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.GRASS_WATER_PLEDGE, ArenaTagSide.ENEMY)).toBeUndefined();
  });
});

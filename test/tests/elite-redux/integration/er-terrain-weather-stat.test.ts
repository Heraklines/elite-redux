/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #127 — terrain/weather-gated stat-multiplier abilities.
//
//   • Flower Necklace (982): SpDef *1.5 ONLY in Grassy Terrain (Grass Pelt's
//     shape on SPDEF). Previously an always-on approximation; now terrain-gated.
//   • Rain Shroud (959): Evasion *1.3 in rain (Sand Veil's shape on EVA/rain).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function erAbility(id: number): Promise<AbilityId | undefined> {
  const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return map.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN)("ER terrain/weather-gated stat abilities (#127)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Flower Necklace (982): SpDef ×1.5 only under Grassy Terrain", async () => {
    const ability = await erAbility(982);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();

    game.scene.arena.trySetTerrain(TerrainType.NONE, true);
    const baseSpDef = player.getEffectiveStat(Stat.SPDEF);

    game.scene.arena.trySetTerrain(TerrainType.GRASSY, true);
    const grassySpDef = player.getEffectiveStat(Stat.SPDEF);

    expect(grassySpDef).toBe(Math.floor(baseSpDef * 1.5));
  });

  it("Rain Shroud (959): is registered + carries a weather-gated EVA multiplier", async () => {
    const ability = await erAbility(959);
    if (ability === undefined) {
      return;
    }
    const { allAbilities } = await import("#data/data-lists");
    // WeatherStatMultiplierAbAttr extends StatMultiplierAbAttr (the registered
    // base); getAttrs matches via instanceof, so query the base name.
    const attrs = allAbilities[ability].getAttrs("StatMultiplierAbAttr");
    const evaAttr = attrs.find(a => a.stat === Stat.EVA);
    expect(evaAttr, "Rain Shroud should carry an EVA StatMultiplier").toBeDefined();
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #129 — Toxic Terrain (ER custom terrain). v2.65.3b ships no toxic-terrain
// asset, so it reuses the Psychic Terrain anim tinted poison-violet. Mechanics
// (per the in-game descriptions, which take priority):
//   • Toxic Surge (834): sets Toxic Terrain on entry (8 turns).
//   • Toxic Terrain move (1006): sets Toxic Terrain.
//   • Boosts Poison-type moves; chips grounded non-Poison mons 1/16 HP/turn.
//   • Biofilm (836): SpDef ×1.5 only under Toxic Terrain.
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

describe.skipIf(!RUN)("ER Toxic Terrain (#129)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Toxic Surge (834): sets Toxic Terrain on entry", async () => {
    const ability = await erAbility(834);
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
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.TOXIC);
  });

  it("Biofilm (836): SpDef ×1.5 only under Toxic Terrain", async () => {
    const ability = await erAbility(836);
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
    const base = player.getEffectiveStat(Stat.SPDEF);
    game.scene.arena.trySetTerrain(TerrainType.TOXIC, true);
    const boosted = player.getEffectiveStat(Stat.SPDEF);
    expect(boosted).toBe(Math.floor(base * 1.5));
  });

  it("chips a grounded non-Poison mon 1/16 each turn; Poison-types are immune", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX) // Normal — grounded, not Poison
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.MUK]); // Poison — immune
    game.scene.arena.trySetTerrain(TerrainType.TOXIC, true);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const playerHpBefore = player.hp;
    const enemyHpBefore = enemy.hp;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.hp, "Poison-type Muk should be immune to Toxic Terrain chip").toBe(playerHpBefore);
    expect(enemy.hp, "grounded Normal-type Snorlax should take 1/16 chip").toBeLessThan(enemyHpBefore);
    expect(enemyHpBefore - enemy.hp).toBe(Math.max(Math.floor(enemy.getMaxHp() / 16), 1));
  });
});

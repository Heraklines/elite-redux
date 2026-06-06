/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Repro for ER bug report (b): "Hitting for super-effective damage even though
// Gravity is present" — screenshot shows a Rock move at 2x on a Flying-type
// (Cramorant) while Gravity is active.
//
// This test proves the Gravity <-> type-effectiveness/grounding interaction is
// CORRECT by calling getAttackTypeEffectiveness directly (no flaky move-select):
//   - Gravity grounds Flying types -> GROUND hits them for NORMAL (1x), not 0x.
//   - Gravity does NOT remove the Flying type for other matchups, so ROCK stays
//     2x super-effective vs a Flying-type whether or not Gravity is up.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER Gravity <-> type effectiveness", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.PIDGEOT).startingLevel(50).enemyLevel(50);
  });

  function addGravity() {
    const player = game.field.getPlayerPokemon();
    game.scene.arena.addTag(ArenaTagType.GRAVITY, 5, undefined, player.id, ArenaTagSide.BOTH, true);
    expect(game.scene.arena.getTag(ArenaTagType.GRAVITY)).toBeDefined();
  }

  it("a pure-Flying target is GROUND-immune without Gravity", async () => {
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const enemy = game.field.getEnemyPokemon();
    // Pidgeot is Normal/Flying in canon. Ground vs Flying-component is 0x (immune).
    expect(enemy.isOfType(PokemonType.FLYING)).toBe(true);
    expect(game.scene.arena.getTag(ArenaTagType.GRAVITY)).toBeUndefined();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.GROUND, {})).toBe(0);
  });

  it("Gravity grounds the Flying target: GROUND becomes NORMAL (1x), NOT super-effective", async () => {
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const enemy = game.field.getEnemyPokemon();
    addGravity();
    // Flying type spliced out for GROUND only -> remaining Normal component = 1x.
    expect(enemy.getAttackTypeEffectiveness(PokemonType.GROUND, {})).toBe(1);
  });

  it("ROCK stays 2x super-effective vs the Flying target WITH Gravity (matches the user screenshot — correct)", async () => {
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.getAttackTypeEffectiveness(PokemonType.ROCK, {});
    addGravity();
    const after = enemy.getAttackTypeEffectiveness(PokemonType.ROCK, {});
    expect(before, "Rock vs Flying is 2x without Gravity").toBe(2);
    expect(after, "Rock vs Flying stays 2x with Gravity (Gravity only removes the GROUND immunity)").toBe(2);
  });

  it("Cramorant (Flying/Water): ROCK is 2x with and without Gravity (exact reported case)", async () => {
    game.override.enemySpecies(SpeciesId.CRAMORANT);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.getAttackTypeEffectiveness(PokemonType.ROCK, {});
    addGravity();
    const after = enemy.getAttackTypeEffectiveness(PokemonType.ROCK, {});
    expect(before).toBe(2);
    expect(after).toBe(2);
    // And Ground is grounded to neutral by Gravity, not immune.
    expect(enemy.getAttackTypeEffectiveness(PokemonType.GROUND, {})).toBe(1);
  });
});

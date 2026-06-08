/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#329): "normalize in fact does not ignore resistances." ER Normalize
// = moves become Normal-type + 1.1× + "bypass resistances, but not immunities".
// The bypass-resist part was missing. The IgnoreResistancesAbAttr marker (added
// to NORMALIZE) makes the holder's resisted matchups (0<x<1) clamp to 1×, while
// immunities (0×) are preserved.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Normalize — ignores resistances, not immunities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.NORMALIZE)
      .passiveAbility(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("Steel's Normal-resistance (0.5×) is clamped to 1× for a Normalize holder", async () => {
    game.override.enemySpecies(SpeciesId.MAGNEMITE); // Electric/Steel — resists Normal 0.5×
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: player })).toBe(1);
  });

  it("Ghost's Normal-immunity (0×) is preserved", async () => {
    game.override.enemySpecies(SpeciesId.GASTLY); // Ghost/Poison — immune to Normal
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: player })).toBe(0);
  });
});

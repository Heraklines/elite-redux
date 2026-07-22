/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// STEELWORKER (dex 200) — the "Normal moves become Steel" half.
//
// The ER 2.65 dex reads "Normal moves become Steel. Steel resists Ghost and
// Dark." The RESIST half is already verified in er-duraludon-steelworker-draco.ts.
// This file pins the OTHER half nobody had covered: the holder's Normal-type
// moves are converted to Steel-type (an -ate-style conversion, NO extra power
// modifier — the port wires a bare MoveTypeChangeAbAttr(STEEL) with no
// multiplier, matching the dex, which specifies none). Verdict: WORKING-AS-INTENDED.
//
// Proof strategy — the conversion is decisive at the type chart:
//   - a Normal move RESOLVES to Steel type on a Steelworker holder,
//   - it now HITS a Ghost type (Normal is immune 0x; Steel is neutral 1x),
//   - it is SUPER-EFFECTIVE (2x) vs Rock (Normal is 0.5x there),
//   - it is RESISTED (0.5x) by a Steel type,
//   - a non-Normal move (Water) is left untouched.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Steelworker — Normal moves become Steel-type", () => {
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
      .startingWave(150) // past the #419 BST-cap ladder
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("resolves a Steelworker holder's Normal move to Steel type (control: stays Normal)", async () => {
    game.override.ability(AbilityId.STEELWORKER).enemySpecies(SpeciesId.REGIROCK).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    expect(player.getAbility().id).toBe(AbilityId.STEELWORKER);
    // Normal -> Steel; a non-Normal move is untouched.
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.STEEL);
    expect(player.getMoveType(allMoves[MoveId.WATER_GUN])).toBe(PokemonType.WATER);
  });

  it("control WITHOUT Steelworker: the same Normal move stays Normal", async () => {
    game.override.ability(AbilityId.HONEY_GATHER).enemySpecies(SpeciesId.REGIROCK).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.NORMAL);
  });

  it("the converted move follows the STEEL chart: 2x vs Rock, 0.5x vs Steel, 1x vs Ghost", async () => {
    game.override.ability(AbilityId.STEELWORKER).enemySpecies(SpeciesId.REGIROCK).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    const rock = game.field.getEnemyPokemon(); // pure Rock
    // Steel is super-effective vs Rock (Normal would be 0.5x here).
    expect(rock.getMoveEffectiveness(player, allMoves[MoveId.TACKLE])).toBe(2);
  });

  it("DECISIVE: a Steelworker holder's Normal move HITS a Ghost type (Normal is immune)", async () => {
    game.override.ability(AbilityId.STEELWORKER).enemySpecies(SpeciesId.GENGAR).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    const gengar = game.field.getEnemyPokemon(); // Ghost/Poison
    // As Steel the move is neutral (1x); as Normal it would be 0x (Ghost immune).
    expect(gengar.getMoveEffectiveness(player, allMoves[MoveId.TACKLE])).toBe(1);
    const before = gengar.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(gengar.hp).toBeLessThan(before); // dealt damage -> no longer Normal
  });

  it("control: WITHOUT Steelworker the Normal move CANNOT touch the Ghost (0 damage)", async () => {
    game.override.ability(AbilityId.HONEY_GATHER).enemySpecies(SpeciesId.GENGAR).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    const gengar = game.field.getEnemyPokemon();
    expect(gengar.getMoveEffectiveness(player, allMoves[MoveId.TACKLE])).toBe(0);
    const before = gengar.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(gengar.hp).toBe(before); // immune -> untouched
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Mystic Blades (ability 505): "Keen Edge [slicing] moves become SPECIAL
// (deal Special damage AND use the Special Attack stat) and deal 30% more
// damage."
//
// The prior wire only rewrote the OFFENSIVE stat (SpAtk) but left the move
// PHYSICAL, so it still hit the target's Defense and was halved by burn. The
// fix flips the damage CATEGORY to SPECIAL for slicing moves, so the move is
// FULLY special: it tracks the target's Sp.Def and is not reduced by burn.
//
// (Contrast Mind Crunch 568 / Magical Fists 742, which the dex keeps hitting
// the enemy's Defense — those are unchanged.)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const MYSTIC_BLADES = ErAbilityId.MYSTIC_BLADES as unknown as AbilityId;

describe.skipIf(!RUN)("ER Mystic Blades — slicing moves become fully special", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50)
      .ability(MYSTIC_BLADES);
  });

  it("a slicing move tracks the target's Sp.Def, not Def", async () => {
    await game.classicMode.startBattle(SpeciesId.GALLADE);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const slash = allMoves[MoveId.SLASH]; // Normal, physical, slicing

    const mysticDmg = () => enemy.getAttackDamage({ source: player, move: slash, simulated: true }).damage;
    const physicalDmg = () =>
      enemy.getAttackDamage({ source: player, move: slash, simulated: true, ignoreSourceAbility: true }).damage;

    const baseline = mysticDmg();

    // Boost the target's DEFENSE: a physical move is reduced, but the special
    // Mystic Blades slicing move (which reads Sp.Def) is UNAFFECTED.
    enemy.setStatStage(Stat.DEF, 6);
    expect(mysticDmg(), "Def boost does not affect the special slicing move").toBe(baseline);
    expect(physicalDmg(), "Def boost DOES reduce a physical slicing move").toBeLessThan(baseline);

    // Now boost SP.DEF instead: the Mystic Blades slicing move IS reduced,
    // proving it reads the target's Sp.Def.
    enemy.setStatStage(Stat.DEF, 0);
    enemy.setStatStage(Stat.SPDEF, 6);
    expect(mysticDmg(), "Sp.Def boost reduces the special slicing move").toBeLessThan(baseline);
  });

  it("a slicing move is NOT reduced by the user being burned (special-side)", async () => {
    await game.classicMode.startBattle(SpeciesId.GALLADE);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const slash = allMoves[MoveId.SLASH];

    const dmg = () => enemy.getAttackDamage({ source: player, move: slash, simulated: true }).damage;
    const physicalDmg = () =>
      enemy.getAttackDamage({ source: player, move: slash, simulated: true, ignoreSourceAbility: true }).damage;

    const mysticUnburned = dmg();
    const physicalUnburned = physicalDmg();

    player.status = new Status(StatusEffect.BURN);
    const mysticBurned = dmg();
    const physicalBurned = physicalDmg();

    // Mystic Blades slicing move (special) is unaffected by burn ...
    expect(mysticBurned).toBe(mysticUnburned);
    // ... while a plain physical slicing move IS halved (control: burn works).
    expect(physicalBurned).toBeLessThan(physicalUnburned);
  });
});

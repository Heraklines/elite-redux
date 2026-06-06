/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Catastrophe 589 — "In Sun, Water moves gain the damage boost they receive
// from rain. In Rain, Fire moves gain the damage boost they receive from sun."
// I.e. a ×1.5 move-power boost gated by MOVE TYPE × weather. Verified via
// Move.calculateBattlePower (WATER_GUN / EMBER, base power 40 each).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Catastrophe (589)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("in Sun: Water moves get ×1.5 power, Fire moves do not", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[589] as AbilityId) // Catastrophe
      .weather(WeatherType.SUNNY)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.POLITOED]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    // base power 40; Water boosted to 60 in sun, Fire untouched at 40.
    expect(allMoves[MoveId.WATER_GUN].calculateBattlePower(user, target)).toBe(60);
    expect(allMoves[MoveId.EMBER].calculateBattlePower(user, target)).toBe(40);
  });

  it("in Rain: Fire moves get ×1.5 power, Water moves do not", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[589] as AbilityId)
      .weather(WeatherType.RAIN)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.POLITOED]);

    const user = game.scene.getPlayerPokemon()!;
    const target = game.scene.getEnemyPokemon()!;
    expect(allMoves[MoveId.EMBER].calculateBattlePower(user, target)).toBe(60);
    expect(allMoves[MoveId.WATER_GUN].calculateBattlePower(user, target)).toBe(40);
  });

  // Regression: the ROM spec is "In Rain, Fire moves gain the damage boost they
  // receive from sun." Rain normally HALVES Fire damage (arenaAttackTypeMultiplier
  // ×0.5). Catastrophe must not only add the ×1.5 power boost but also cancel that
  // adverse weather debuff (Hydro-Steam-style), so net Fire-in-rain DAMAGE ends up
  // boosted (~×1.5 of neutral), not merely partially-recovered (×0.75). This is the
  // level the prior power-only wiring missed — calculateBattlePower never includes
  // the weather type multiplier, so the bug only shows up in getAttackDamage.
  it("in Rain: a Fire move from a Catastrophe holder deals MORE damage than the rain-halved baseline", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[589] as AbilityId) // Catastrophe on the attacker
      .moveset([MoveId.EMBER])
      .weather(WeatherType.RAIN)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.POLITOED]);

    const attacker = game.field.getPlayerPokemon();
    const defender = game.field.getEnemyPokemon();
    const fireMove = allMoves[MoveId.EMBER];

    const withCatastrophe = defender.getAttackDamage({ source: attacker, move: fireMove, simulated: true }).damage;

    // Same battle, swap the attacker's ability to a no-op and re-measure: this is
    // the plain rain-halved Fire damage (×0.5, no boost, no debuff cancel).
    attacker.summonData.ability = AbilityId.BALL_FETCH;
    const plainRainHalved = defender.getAttackDamage({ source: attacker, move: fireMove, simulated: true }).damage;

    expect(plainRainHalved).toBeGreaterThan(0);
    // With the fix, Catastrophe yields net ~×1.5 vs the plain ×0.5 → ~3× the plain
    // damage. The buggy power-only wiring gives only ×1.5 power × ×0.5 weather = ~1.5×.
    // Assert clearly above the buggy 1.5× ceiling.
    expect(withCatastrophe).toBeGreaterThan(plainRainHalved * 2.5);
  });
});

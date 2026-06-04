/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ice Statue (BattlerTagType.ER_ICE_STATUE) — applied by Hollow Ice Zone
// (979). The afflicted target:
//   - becomes pure Ice-type (type override on add),
//   - gains NO resistances (Ice-resists-Ice 0.5× is clamped to neutral 1×),
//   - keeps Ice's weaknesses (Fire/Fighting/Rock/Steel still 2×),
//   - LOSES the Ice-type immunity to frostbite (ER_FROSTBITE becomes addable).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Ice Statue status", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("makes the target pure Ice with no resistances + no frostbite immunity", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    // Lapras is Water/Ice and normally resists Ice.
    const mon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.LAPRAS), 50);
    expect(mon.getAttackTypeEffectiveness(PokemonType.ICE)).toBeLessThan(1);

    mon.addTag(BattlerTagType.ER_ICE_STATUE);

    // Type override → pure Ice.
    expect(mon.getTypes(true)).toEqual([PokemonType.ICE]);
    // No resistances: Ice-resists-Ice (0.5×) is clamped to neutral.
    expect(mon.getAttackTypeEffectiveness(PokemonType.ICE)).toBe(1);
    // Neutral matchups stay neutral.
    expect(mon.getAttackTypeEffectiveness(PokemonType.WATER)).toBe(1);
    // Weaknesses still apply (Ice is weak to Fire).
    expect(mon.getAttackTypeEffectiveness(PokemonType.FIRE)).toBe(2);
    // Frostbite immunity is removed — the Ice-type target CAN be frostbitten.
    expect(mon.canAddTag(BattlerTagType.ER_FROSTBITE)).toBe(true);
  });

  it("Hollow Ice Zone (979) applies Ice Statue with an Ice-type move", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[979] as AbilityId)
      .moveset([MoveId.ICE_BEAM])
      .enemySpecies(SpeciesId.SNORLAX) // bulky — survives a single Ice Beam
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    // Two-mon party so the ability's self-switch has a valid backup.
    await game.classicMode.startBattle([SpeciesId.GLALIE, SpeciesId.MAGIKARP]);

    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.ICE_BEAM);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.ER_ICE_STATUE)).toBeDefined();
    expect(enemy.getTypes(true)).toEqual([PokemonType.ICE]);
  });
});

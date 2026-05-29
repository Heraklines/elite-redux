/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #130/#131 — Best Offense (844): "Mystic blades + use 20% of spdef during
// moves." The holder's offensive stat (ATK physical / SPATK special) gains 20%
// of its Sp. Def while attacking (StatBlendAbAttr). Verified via getEffectiveStat.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

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

describe.skipIf(!RUN)("ER Best Offense stat-blend (#130)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Best Offense (844): ATK and SpAtk each gain 20% of Sp. Def while attacking", async () => {
    const ability = await erAbility(844);
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

    const baseAtk = player.getStat(Stat.ATK, false);
    const baseSpAtk = player.getStat(Stat.SPATK, false);
    const spDef = player.getStat(Stat.SPDEF, false);
    const expectedBlend = Math.floor(0.2 * spDef);

    // getEffectiveStat ignoring held items / opp ability to isolate the blend.
    const effAtk = player.getEffectiveStat(Stat.ATK);
    const effSpAtk = player.getEffectiveStat(Stat.SPATK);

    expect(effAtk).toBe(baseAtk + expectedBlend);
    expect(effSpAtk).toBe(baseSpAtk + expectedBlend);
    // Defensive stats must be untouched.
    expect(player.getEffectiveStat(Stat.DEF)).toBe(player.getStat(Stat.DEF, false));
  });
});

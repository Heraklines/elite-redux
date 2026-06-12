/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#429): Power of Alchemy is REDEFINED in Elite Redux - "Upon entry,
// transmutes all opposing Berries into Black Sludge..." - but it still had
// vanilla's copy-a-fainted-ally's-ability effect (and so disagreed with the
// ER description shown in the detail view, the Alolan Muk report). The
// vanilla copy attr is stripped and an entry effect destroys all opposing
// berries (pokerogue has no held Black Sludge, so denial is the port).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BerryModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER #429 - Power of Alchemy transmutes opposing berries on entry", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHeldItems([
        { name: "BERRY", type: BerryType.SITRUS },
        { name: "BERRY", type: BerryType.LUM },
      ])
      .ability(AbilityId.POWER_OF_ALCHEMY)
      .moveset([MoveId.SPLASH]);
  });

  it("the vanilla copy-fainted-ally attr is gone and the ER description is pinned", () => {
    const ability = allAbilities[AbilityId.POWER_OF_ALCHEMY];
    expect(ability.attrs.some(a => a.constructor.name === "CopyFaintedAllyAbilityAbAttr")).toBe(false);
    expect(ability.attrs.some(a => a.constructor.name === "ErTransmuteOpposingBerriesAbAttr")).toBe(true);
    expect(ability.description.toLowerCase()).toContain("transmut");
  });

  it("destroys ALL opposing berries on entry", async () => {
    await game.classicMode.startBattle(SpeciesId.ALOLA_MUK);
    const enemy = game.scene.getEnemyPokemon()!;
    const berries = globalScene.findModifiers(m => m instanceof BerryModifier && m.pokemonId === enemy.id, false);
    expect(berries).toHaveLength(0);
  });
});

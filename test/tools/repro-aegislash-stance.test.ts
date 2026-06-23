/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO: vanilla Aegislash (shield/blade) must use VANILLA Stance Change - ANY
// damaging move (incl. SPECIAL, e.g. Vacuum Wave) brings out Blade Forme; King's
// Shield returns to Shield. ER wrongly applied the Redux physical/special split
// to vanilla Aegislash, so a special-only Aegislash never reached Blade (live
// report: "Aegislash spammed Vacuum Wave for 2 turns and never changed stance").
//
// NOTE: spawn at wave 145 so the #419 elite BST-cap doesn't devolve Aegislash
// (BST 500) down to Honedge at a low wave - at low waves the override yields
// Honedge, which is NOT in the Aegislash form-change registry.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-aegislash-stance.test.ts

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: vanilla Aegislash stance change", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("a SPECIAL move (Vacuum Wave) flips Shield -> Blade", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.AEGISLASH)
      .enemyMoveset(MoveId.VACUUM_WAVE)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(70)
      .enemyLevel(70)
      .startingWave(145)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const e = game.field.getEnemyPokemon();
    console.log(`start: #${e.species.speciesId} "${e.species.name}" form#${e.formIndex} key="${e.getFormKey()}"`);
    expect(e.species.speciesId, "should be a real Aegislash, not a BST-capped devolve").toBe(SpeciesId.AEGISLASH);
    expect(e.formIndex, "starts in Shield").toBe(0);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    console.log(`after enemy Vacuum Wave: form#${e.formIndex} key="${e.getFormKey()}"`);
    expect(e.formIndex, "a special damaging move must bring out Blade Forme").toBe(1);
  }, 120_000);

  it("King's Shield returns Blade -> Shield (and a special move alone does not)", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.STANCE_CHANGE)
      .moveset([MoveId.SHADOW_BALL, MoveId.KINGS_SHIELD])
      .startingLevel(70)
      .enemyLevel(70)
      .startingWave(145)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.AEGISLASH);
    const p = game.field.getPlayerPokemon();
    expect(p.formIndex, "player Aegislash starts in Shield").toBe(0);

    game.move.use(MoveId.SHADOW_BALL); // special, damaging -> Blade
    await game.toEndOfTurn();
    console.log(`player after Shadow Ball: form#${p.formIndex}`);
    expect(p.formIndex, "special damaging move -> Blade").toBe(1);

    game.move.use(MoveId.KINGS_SHIELD); // -> back to Shield
    await game.toEndOfTurn();
    console.log(`player after King's Shield: form#${p.formIndex}`);
    expect(p.formIndex, "King's Shield -> Shield").toBe(0);
  }, 120_000);
});

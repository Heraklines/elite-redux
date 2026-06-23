/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO: Zacian-Crowned (vanilla Zacian + Rusted Sword -> Crowned Sword form,
// formIndex 1) should have ER abilities:
//   Ability: Crowned Sword | Innate 1: Steelworker | Innate 2: Battle Armor |
//   Innate 3: Keen Edge
// Players report it keeps base/vanilla abilities after the form change.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-zacian-crowned.test.ts

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: Zacian Crowned abilities", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Crowned form has Crowned Sword + Steelworker/Battle Armor/Keen Edge", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .starterForms({ [SpeciesId.ZACIAN]: 1 }) // Crowned Sword form
      .startingLevel(70)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.ZACIAN);

    const z = game.field.getPlayerPokemon();
    const active = z.getAbility()?.name ?? "(none)";
    const passives = z
      .getPassiveAbilities()
      .map(a => a?.name)
      .filter(Boolean);
    console.log(`Zacian form#${z.formIndex} active="${active}" innates=[${passives.join(", ")}]`);

    const all = [active, ...passives].map(s => (s ?? "").toLowerCase());
    const has = (name: string) => all.some(a => a.includes(name));
    for (const want of ["crowned sword", "steelworker", "battle armor", "keen edge"]) {
      console.log(`  ${has(want) ? "OK " : "MISSING"} ${want}`);
    }
    expect(has("crowned sword"), "active ability should be Crowned Sword").toBe(true);
    expect(has("keen edge"), "should have Keen Edge innate").toBe(true);
  }, 120_000);
});

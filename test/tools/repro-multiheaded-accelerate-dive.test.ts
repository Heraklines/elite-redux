/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #617: Multi-Headed (per-head multi-strike) did NOT activate on an
// Accelerate-boosted Dive. Multi-Headed reuses Move.canBeMultiStrikeEnhanced, which
// statically excludes ANY charging move (`if (this.isChargingMove()) return false`).
// Accelerate (SkipChargeTurnAbAttr) makes Dive resolve in a SINGLE turn - it is no
// longer a two-turn move - so it should be eligible. The static check ignores that.
//
// Contract this asserts:
//   - Dive + user WITH Accelerate (skips the charge) -> eligible (currently FALSE = bug)
//   - Dive + user withOUT Accelerate -> still ineligible (preserve vanilla Parental Bond)
//   - Tackle (normal move) -> always eligible (unaffected control)
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-multiheaded-accelerate-dive.test.ts

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: Multi-Headed skips Accelerate-resolved Dive (#617)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("an Accelerate user's Dive is multi-strike eligible; a normal user's Dive is not", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .passiveAbility(ErAbilityId.ACCELERATE as unknown as AbilityId)
      .hasPassiveAbility(true)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .moveset([MoveId.DIVE, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.DODRIO);

    const user = game.field.getPlayerPokemon();
    const hasAccelerate = user.hasAbility(ErAbilityId.ACCELERATE as unknown as AbilityId);
    const dive = allMoves[MoveId.DIVE];
    const tackle = allMoves[MoveId.TACKLE];

    const diveEligible = dive.canBeMultiStrikeEnhanced(user);
    const tackleEligible = tackle.canBeMultiStrikeEnhanced(user);
    console.log(
      `user has Accelerate=${hasAccelerate}; Dive.canBeMultiStrikeEnhanced=${diveEligible}; `
        + `Tackle.canBeMultiStrikeEnhanced=${tackleEligible}; Dive.isChargingMove=${dive.isChargingMove()}`,
    );

    expect(hasAccelerate, "the Accelerate passive must be active on the user").toBe(true);
    expect(tackleEligible, "a normal move is always multi-strike eligible (control)").toBe(true);
    // THE BUG: an Accelerate-resolved (single-turn) Dive should be eligible for Multi-Headed.
    expect(diveEligible, "Accelerate makes Dive a single-turn move -> it must be multi-strike eligible").toBe(true);
  }, 120_000);

  it("withOUT Accelerate, a charge move (Dive) stays multi-strike INELIGIBLE (vanilla preserved)", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .moveset([MoveId.DIVE]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const user = game.field.getPlayerPokemon();
    const diveEligible = allMoves[MoveId.DIVE].canBeMultiStrikeEnhanced(user);
    console.log(`no-Accelerate user: Dive.canBeMultiStrikeEnhanced=${diveEligible}`);
    expect(diveEligible, "a normal charge move stays ineligible (don't change Parental Bond)").toBe(false);
  }, 120_000);
});

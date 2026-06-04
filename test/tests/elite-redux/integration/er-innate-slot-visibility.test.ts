/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER 3-passive model — innate abilities in slots 1 and 2 must be visible to the
// Pokemon query methods (hasAbility / hasAbilityWithAttr / getAbilityAttrs), not
// just slot 0. Before the fix, these methods consulted getPassiveAbility() (slot
// 0 only), so an innate in slot 1/2 was invisible to every game system that
// checks abilities through them (immunities, type interactions, AI). This is the
// general class of bug behind reports like "innate Rock Head doesn't apply".
//
// The fix is species-agnostic, so the test is data-driven: take a mon with a
// populated innate triple, find an ability that lives ONLY in slot 1 or 2
// (distinct from the active ability and slot 0), and assert the query methods
// report it. Before the fix hasAbility(thatId) returned false.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER innate slot visibility", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("query methods see an innate ability in slot 1/2, not just slot 0", async () => {
    game.override
      .battleStyle("single")
      .hasPassiveAbility(true)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle([SpeciesId.SALAMENCE]);
    const p = game.field.getPlayerPokemon();

    const passives = p.getPassiveAbilities();
    const activeId = p.getAbility().id;
    const slot0Id = passives[0]?.id;

    // Find an innate that lives ONLY in slot 1 or 2 (distinct from active + slot 0)
    // so a passing assertion can only be explained by the slot-1/2 fix.
    let testId: AbilityId | undefined;
    for (let slot = 1; slot < 3; slot++) {
      const ab = passives[slot];
      if (ab && ab.id !== activeId && ab.id !== slot0Id) {
        testId = ab.id;
        break;
      }
    }
    // Salamence has a populated 3-innate triple in the ER build; if this ever
    // changes the test should be retargeted rather than silently passing.
    expect(testId, "expected a distinct innate in slot 1/2 to test against").toBeDefined();

    // The fix: hasAbility must report the slot-1/2 innate (was false before).
    expect(p.hasAbility(testId!)).toBe(true);

    // Find a (slot-1/2 innate, attr-name) pair where the innate genuinely reports
    // the attr via hasAttr (so the name round-trips through the AbAttrString
    // registry — some ER-custom attrs do not). Then the same slot is visible to
    // hasAbilityWithAttr / getAbilityAttrs. The three methods share one loop, so
    // this is belt-and-suspenders over the hasAbility proof above.
    let attrName: Parameters<typeof p.hasAbilityWithAttr>[0] | undefined;
    for (let slot = 1; slot < 3 && !attrName; slot++) {
      const ab = passives[slot];
      if (!ab || ab.id === activeId || ab.id === slot0Id) {
        continue;
      }
      for (const attr of ab.attrs) {
        const name = attr.constructor.name as Parameters<typeof p.hasAbilityWithAttr>[0];
        if (ab.hasAttr(name)) {
          attrName = name;
          break;
        }
      }
    }
    expect(attrName, "expected a registry-known attr on a slot-1/2 innate").toBeDefined();
    expect(p.hasAbilityWithAttr(attrName!)).toBe(true);
    expect(p.getAbilityAttrs(attrName!).length).toBeGreaterThan(0);
  });
});

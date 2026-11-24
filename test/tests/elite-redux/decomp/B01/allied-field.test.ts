/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 proof for AlliedFieldDamageReductionAbAttr (Friend Guard, Food Lovers, Caretaker) and the Water half of
// ReceivedTypeDamageMultiplierAbAttr. Friend Guard is only asked in a battle with an ally of the hit Pokemon, which the
// shared single-battle template never has (requests/B01.md, R-B01-7/8); the Water moves are left out of the shared
// probes because Dry Skin absorbs them (R-B01-8).
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { twinRebuild } from "#test/tests/elite-redux/decomp/B01/twin-helpers";
import type { ScenarioContext, ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { celebrate, TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// Doubles: the holder (Friend Guard) has an ally, and both enemies use a damaging move for three turns, so the ally is
// hit by at least one of them with the pinned seed.
const DOUBLES_HIT: ScenarioSpec = {
  ...TEMPLATES["doubles-ally"],
  id: "b01-doubles-hit",
  label: "Doubles: the enemies attack the holder and its ally for three turns",
  foeMoves: [MoveId.TACKLE],
  // Both of my Pokemon must pick a move in a double battle: the template only picks the first one.
  turns: [0, 1, 2].map(() => ({
    ...celebrate(),
    afterSelect: (ctx: ScenarioContext) => ctx.game.move.select(MoveId.CELEBRATE, 1),
  })),
};

const WATER_HIT: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "b01-water-hit",
  label: "The enemy attacks the holder with a Water move",
  foeMoves: [MoveId.WATER_GUN],
  turns: [celebrate(), celebrate()],
};

describe("B01 damage reductions, real battles", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Friend Guard: the rebuilt AlliedFieldDamageReductionAbAttr reduces an ally's damage, exactly like the original", async () => {
    const same = await twinRebuild(phaserGame, AbilityId.FRIEND_GUARD, DOUBLES_HIT, {
      attrs: [{ attrIndex: 0, className: "AlliedFieldDamageReductionAbAttr" }],
      wave: 2,
    });
    expect(same.rebuiltAttrs).toContain(0);
    expect(same.report).toBe("");
    // Mutation: without the attr the ally takes more damage, so the traces must differ.
    const mutated = await twinRebuild(phaserGame, AbilityId.FRIEND_GUARD, DOUBLES_HIT, {
      attrs: [],
      drop: [0],
      wave: 2,
    });
    expect(mutated.outcome.differences.length).toBeGreaterThan(0);
  });

  it("Magma Armor: the rebuilt Water (x0.7) and Ice attrs take less damage from a Water move, exactly like the original", async () => {
    expect(allMoves[MoveId.WATER_GUN].type).toBeDefined();
    const same = await twinRebuild(phaserGame, AbilityId.MAGMA_ARMOR, WATER_HIT, {
      attrs: [
        { attrIndex: 2, className: "ReceivedTypeDamageMultiplierAbAttr" },
        { attrIndex: 3, className: "ReceivedTypeDamageMultiplierAbAttr" },
      ],
    });
    expect(same.rebuiltAttrs).toEqual(expect.arrayContaining([2, 3]));
    expect(same.report).toBe("");
    const mutated = await twinRebuild(phaserGame, AbilityId.MAGMA_ARMOR, WATER_HIT, { attrs: [], drop: [2, 3] });
    expect(mutated.outcome.differences.length).toBeGreaterThan(0);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 2: Two-Faced Unleashed (5977), the power attr. The grid never has the other face out, so these probes
// unleash it through the real prepare/finish helpers and compare the attr with its rebuild.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  finishTwoFacedMove,
  prepareTwoFacedMove,
  type TwoFacedPowerAbAttr,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TWO_FACED = 5977;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Two-Faced Unleashed power", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const power = (holder: Pokemon, foe: Pokemon, moveId: MoveId): never =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      power: new NumberHolder(100),
      simulated: false,
    }) as never;
  const powerAfter = (attr: AbAttr, holder: Pokemon, foe: Pokemon, moveId: MoveId): number => {
    const params = power(holder, foe, moveId);
    attr.apply(params);
    return (params as { power: NumberHolder }).power.value;
  };

  it("needs a damaging move AND the other face out this turn; the old literals are the defaults; the rebuild agrees", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(TWO_FACED).attrs[0] as TwoFacedPowerAbAttr;
    expect([original.unleashedMultiplier, original.typeBonusMultiplier]).toEqual([1.5, 1.4]);
    const rebuilt = recomposeAttr(module("TwoFacedPowerAbAttr"), original, TWO_FACED, 0) as AbAttr;
    expect(rebuilt).not.toBe(original);
    const both = (moveId: MoveId): [boolean, boolean] => [
      original.canApply(power(holder, foe, moveId)),
      rebuilt.canApply(power(holder, foe, moveId)),
    ];
    expect(both(MoveId.TACKLE)).toEqual([false, false]);

    // Unleash the face the way the move phase does (it finds the attr by class name).
    const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([original] as never);
    prepareTwoFacedMove(holder, allMoves[MoveId.SWORDS_DANCE]);
    expect(both(MoveId.TACKLE)).toEqual([false, false]);
    prepareTwoFacedMove(holder, allMoves[MoveId.TACKLE]);
    for (const [moveId, expected] of [
      [MoveId.TACKLE, true],
      [MoveId.WATER_GUN, true],
      [MoveId.SWORDS_DANCE, false],
    ] as const) {
      expect([moveId, both(moveId)]).toEqual([moveId, [expected, expected]]);
    }
    // 100 * 1.5 for a plain move, then * 1.4 more for Electric and Dark, as two multiplications.
    for (const attr of [original, rebuilt]) {
      expect(powerAfter(attr, holder, foe, MoveId.TACKLE)).toBe(100 * 1.5);
      expect(powerAfter(attr, holder, foe, MoveId.THUNDERBOLT)).toBe(100 * 1.5 * 1.4);
      expect(powerAfter(attr, holder, foe, MoveId.BITE)).toBe(100 * 1.5 * 1.4);
    }
    // The gate (damaging move) is replaceable, the face-out rule stays.
    const anyMove = buildAttr(module("TwoFacedPowerAbAttr"), {}, { gate: () => true });
    expect(anyMove.canApply(power(holder, foe, MoveId.SWORDS_DANCE))).toBe(true);
    finishTwoFacedMove(holder, allMoves[MoveId.TACKLE]);
    expect(both(MoveId.TACKLE)).toEqual([false, false]);
    expect(anyMove.canApply(power(holder, foe, MoveId.SWORDS_DANCE))).toBe(false);
    spy.mockRestore();
  });

  it("the numbers and the two favoured types are params", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const custom = buildAttr(
      module("TwoFacedPowerAbAttr"),
      { unleashedMultiplier: 2, typeBonusMultiplier: 3, bonusTypeA: "Fire", bonusTypeB: "Water" },
      { gate: () => true },
    );
    expect(powerAfter(custom, holder, foe, MoveId.TACKLE)).toBe(200);
    expect(powerAfter(custom, holder, foe, MoveId.EMBER)).toBe(600);
    expect(powerAfter(custom, holder, foe, MoveId.WATER_GUN)).toBe(600);
    expect(powerAfter(custom, holder, foe, MoveId.THUNDERBOLT)).toBe(200);
  });
});

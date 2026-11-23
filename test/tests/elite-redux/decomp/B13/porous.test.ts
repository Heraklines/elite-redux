/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 1: Porous (5974). The grid and the twin start a plain battle with an empty charge counter, so they only
// prove the "no charge" side. These probes fill, spend and reset the counter through the real attrs and compare the
// two rebuildable attrs (sound reduction, power) with their rebuilds from the declarations.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  type PorousChargeAbAttr,
  type PorousPowerAbAttr,
  type PorousResetAbAttr,
  type PorousSoundReductionAbAttr,
  porousCharges,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const POROUS = 5974;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Porous", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const attrs = () => {
    const list = liveAbility(POROUS).attrs;
    return {
      reset: list[0] as PorousResetAbAttr,
      sound: list[1] as PorousSoundReductionAbAttr,
      charge: list[2] as PorousChargeAbAttr,
      power: list[3] as PorousPowerAbAttr,
    };
  };

  /** The foe uses a move: a new record in its move history (what the charge attr counts once per move). */
  function foeUses(foe: Pokemon, move = MoveId.TACKLE): void {
    foe.pushMoveHistory({
      move,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    });
  }

  const hit = (holder: Pokemon, foe: Pokemon, damage = 10, hitResult = HitResult.EFFECTIVE, simulated = false): never =>
    ({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage, hitResult, simulated }) as never;

  const powerParams = (holder: Pokemon, foe: Pokemon, moveId: MoveId, simulated = false): never =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      power: new NumberHolder(100),
      simulated,
    }) as never;

  it("sound reduction equals its rebuild: halves sound moves only, and its gate is the only clause", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { sound } = attrs();
    const rebuilt = recomposeAttr(module("PorousSoundReductionAbAttr"), sound, POROUS, 1) as AbAttr;
    expect(rebuilt).not.toBe(sound);
    const params = (moveId: MoveId): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[moveId],
        damage: new NumberHolder(100),
        simulated: false,
      }) as never;
    for (const [moveId, expected] of [
      [MoveId.HYPER_VOICE, true],
      [MoveId.BITE, false],
      [MoveId.TACKLE, false],
      [MoveId.EMBER, false],
    ] as const) {
      expect([moveId, sound.canApply(params(moveId))]).toEqual([moveId, expected]);
      expect([moveId, rebuilt.canApply(params(moveId))]).toEqual([moveId, expected]);
    }
    const a = params(MoveId.HYPER_VOICE);
    const b = params(MoveId.HYPER_VOICE);
    sound.apply(a);
    rebuilt.apply(b);
    expect((a as { damage: NumberHolder }).damage.value).toBe(50);
    expect((b as { damage: NumberHolder }).damage.value).toBe(50);
    // The gate can be replaced by any other condition.
    const everything = buildAttr(module("PorousSoundReductionAbAttr"), {}, { gate: () => true });
    expect(everything.canApply(params(MoveId.TACKLE))).toBe(true);
  });

  it("the charge attr counts each foe move once, ignores blocked or zero-damage hits and caps at 3", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { charge, reset } = attrs();
    reset.apply({ pokemon: holder, simulated: false } as never);
    expect(porousCharges(holder)).toBe(0);

    // No foe move on record yet: the foe's record is undefined and so is the freshly reset memory, which are equal, so
    // the hit is not "new" (the clause has no separate "a record exists" test).
    expect(charge.canApply(hit(holder, foe))).toBe(false);
    foeUses(foe);
    expect(charge.canApply(hit(holder, foe, 0))).toBe(false);
    expect(charge.canApply(hit(holder, foe, 10, HitResult.NO_EFFECT))).toBe(false);
    expect(charge.canApply(hit(holder, foe, 10, HitResult.MISS))).toBe(false);
    expect(charge.canApply(hit(holder, foe))).toBe(true);
    charge.apply(hit(holder, foe));
    expect(porousCharges(holder)).toBe(1);
    // The same foe move (a second hit of a multi-hit move) does not count again.
    expect(charge.canApply(hit(holder, foe))).toBe(false);
    for (let i = 0; i < 4; i++) {
      foeUses(foe);
      expect(charge.canApply(hit(holder, foe))).toBe(true);
      charge.apply(hit(holder, foe));
    }
    expect(porousCharges(holder)).toBe(3);

    // The gate slot is replaceable (it is the whole rule), whatever the memory says.
    const open = buildAttr(module("PorousChargeAbAttr"), {}, { gate: () => true });
    const shut = buildAttr(module("PorousChargeAbAttr"), {}, { gate: () => false });
    expect(open.canApply(hit(holder, foe, 0))).toBe(true);
    expect(shut.canApply(hit(holder, foe))).toBe(false);
  });

  it("the power attr equals its rebuild: needs a charge AND a Ground move, spends the charges, and a replaced gate keeps the charge rule", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { reset, charge, power } = attrs();
    const rebuilt = recomposeAttr(module("PorousPowerAbAttr"), power, POROUS, 3) as AbAttr;
    expect(rebuilt).not.toBe(power);
    const both = (moveId: MoveId): [boolean, boolean] => [
      power.canApply(powerParams(holder, foe, moveId)),
      rebuilt.canApply(powerParams(holder, foe, moveId)),
    ];

    reset.apply({ pokemon: holder, simulated: false } as never);
    // No charge: no move is boosted.
    for (const move of [MoveId.EARTHQUAKE, MoveId.TACKLE]) {
      expect(both(move)).toEqual([false, false]);
    }
    // The gate (the move type) is replaceable, but the charge clause (the class's residual) still stands.
    const anyType = buildAttr(module("PorousPowerAbAttr"), {}, { gate: () => true });
    expect(anyType.canApply(powerParams(holder, foe, MoveId.TACKLE))).toBe(false);

    // Two charges.
    for (let i = 0; i < 2; i++) {
      foeUses(foe);
      charge.apply(hit(holder, foe));
    }
    expect(porousCharges(holder)).toBe(2);
    expect(both(MoveId.EARTHQUAKE)).toEqual([true, true]);
    expect(both(MoveId.TACKLE)).toEqual([false, false]);
    expect(anyType.canApply(powerParams(holder, foe, MoveId.TACKLE))).toBe(true);

    // A simulated preview multiplies but does not spend: 100 * (1 + 0.25 * 2) = 150.
    const preview = powerParams(holder, foe, MoveId.EARTHQUAKE, true);
    rebuilt.apply(preview);
    expect((preview as { power: NumberHolder }).power.value).toBeCloseTo(150);
    expect(porousCharges(holder)).toBe(2);

    // The real use multiplies identically and spends everything.
    const real = powerParams(holder, foe, MoveId.EARTHQUAKE);
    rebuilt.apply(real);
    expect((real as { power: NumberHolder }).power.value).toBeCloseTo(150);
    expect(porousCharges(holder)).toBe(0);
    expect(both(MoveId.EARTHQUAKE)).toEqual([false, false]);
  });

  it("the reset attr clears the counter on entry", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { reset, charge } = attrs();
    foeUses(foe);
    charge.apply(hit(holder, foe));
    expect(porousCharges(holder)).toBeGreaterThan(0);
    const rebuilt = recomposeAttr(module("PorousResetAbAttr"), reset, POROUS, 0) as AbAttr;
    expect(rebuilt).not.toBe(reset);
    rebuilt.apply({ pokemon: holder, simulated: false } as never);
    expect(porousCharges(holder)).toBe(0);
  });
});

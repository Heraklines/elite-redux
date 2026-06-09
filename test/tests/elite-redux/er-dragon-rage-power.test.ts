/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: "Dragon Rage" behaved like vanilla (a flat 40 fixed damage) instead
// of ER's version. Vanilla ships power -1 + FixedDamageAttr(40); a c-source
// correction set power:1, but that was INEFFECTIVE while FixedDamageAttr
// overrode the power-based damage formula. ER (er-moves.ts id 82) makes Dragon
// Rage a normal 80-BP damaging Dragon move.
//
// The fix strips FixedDamageAttr (so the standard damage formula applies) and
// pins the base power to 80 via SetBasePowerAttr. We pin via an attr — rather
// than the `.power` scalar — because the c-source-correction pass runs AFTER the
// move-mechanic patcher and overwrites `.power` back to its ROM dummy value (1);
// attrs are not touched by that pass, so the 80 BP survives. Damage stays
// normal (SetBasePowerAttr is a VariablePowerAttr, NOT a FixedDamageAttr).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { SetBasePowerAttr } from "#data/moves/move";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Dragon Rage = normal 80-power Dragon move (not fixed 40)", () => {
  it("no longer carries FixedDamageAttr", () => {
    const move = allMoves[MoveId.DRAGON_RAGE];
    expect(move.attrs.map(a => a.constructor.name)).not.toContain("FixedDamageAttr");
  });

  it("pins base power to 80 via a (normal-damage) SetBasePowerAttr", () => {
    const move = allMoves[MoveId.DRAGON_RAGE];
    const attr = move.attrs.find((a): a is SetBasePowerAttr => a instanceof SetBasePowerAttr);
    expect(attr).toBeDefined();

    // The attr forces base power to 80 at damage-calc time regardless of the
    // (c-source-clobbered) `.power` scalar.
    const power = new NumberHolder(move.power);
    attr?.apply({} as never, {} as never, move, [power]);
    expect(power.value).toBe(80);
  });

  it("remains a Dragon-type damaging move", () => {
    const move = allMoves[MoveId.DRAGON_RAGE];
    expect(move.type).toBe(PokemonType.DRAGON);
  });

  it("damages FAIRY neutrally (1×) instead of the vanilla Dragon 0× immunity", () => {
    // ER clause: "shock waves that can damage Fairy mons". Wired as a
    // type-chart override forcing Fairy's contribution to 1× (neutral).
    const move = allMoves[MoveId.DRAGON_RAGE];
    const attr = move.attrs.find(a => a.constructor.name === "ErSuperEffectiveVsTypeAttr") as
      | { apply(u: unknown, t: unknown, m: unknown, args: unknown[]): boolean }
      | undefined;
    expect(attr, "Dragon Rage must carry the Fairy type-chart override").toBeDefined();

    // Pure Fairy target: multiplier must come out 1 (neutral), not 0 (immune).
    const multiplier = new NumberHolder(0);
    const applied = attr?.apply(null, null, move, [multiplier, [PokemonType.FAIRY], PokemonType.DRAGON]);
    expect(applied).toBe(true);
    expect(multiplier.value).toBe(1);
  });

  it("DISPLAYS power 80 (the .power scalar matches the real BP)", () => {
    // Bug report: the move-info panel showed "power 1". The c-source correction
    // used to pin the scalar to 1 (a stale ROM dummy), so the displayed BP
    // disagreed with the 80 the move actually hits for. The correction now pins
    // the scalar to 80 as well.
    const move = allMoves[MoveId.DRAGON_RAGE];
    expect(move.power).toBe(80);
  });
});

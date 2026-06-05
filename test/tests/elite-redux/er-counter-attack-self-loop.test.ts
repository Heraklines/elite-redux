/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro: a counter-on-hit ability (Wind Chimes → Hyper Voice) looped forever
// when the holder used a SELF-TARGETED status move (Cosmic Power): the holder
// registered as its own attacker, the counter fired at itself, and the self-hit
// re-triggered the counter ("Mega Chimecho hit itself repeatedly"). canApply
// must reject self-inflicted hits and non-damaging moves.

import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

type CanApplyParams = Parameters<CounterAttackOnHitAbAttr["canApply"]>[0];

const mon = () => ({ isFainted: () => false, randBattleSeedInt: () => 0 }) as unknown as CanApplyParams["pokemon"];
const attackMove = { is: (k: string) => k === "AttackMove", hasFlag: () => false } as unknown as CanApplyParams["move"];
const statusMove = { is: (_k: string) => false, hasFlag: () => false } as unknown as CanApplyParams["move"];

describe("ER counter-attack-on-hit guards (self-loop fix)", () => {
  const attr = new CounterAttackOnHitAbAttr({ moveId: MoveId.HYPER_VOICE, power: 30 });

  it("does NOT fire on a self-inflicted hit (self-target move / confusion)", () => {
    const self = mon();
    expect(attr.canApply({ pokemon: self, opponent: self, move: attackMove } as CanApplyParams)).toBe(false);
  });

  it("does NOT fire on a non-damaging (status) move", () => {
    expect(attr.canApply({ pokemon: mon(), opponent: mon(), move: statusMove } as CanApplyParams)).toBe(false);
  });

  it("DOES fire when hit by an opponent's damaging move", () => {
    expect(attr.canApply({ pokemon: mon(), opponent: mon(), move: attackMove } as CanApplyParams)).toBe(true);
  });
});

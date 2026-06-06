/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: "Poison Gas states it does 2x damage to Flying types but it does
// not." ER turns Poison Gas into a 65-BP Special Poison spread move that is
// "super effective vs Flying". This is now modeled as a type-effectiveness
// override (ErSuperEffectiveVsTypeAttr), NOT a silent power multiplier — so the
// game shows "It's super effective!" and the multiplier is a real 2×.
//
// Followup bug: the SE-vs-Flying override used to FLOOR the combined multiplier
// at 2×, which clobbered the rest of the type chart. A Ground/Flying mon like
// Gligar took a flat 2× even though its Ground typing resists Poison (0.5×).
// The fix: the Flying *component* is forced to super-effective (×2) and MULTIPLIES
// into each other defender type's natural contribution. So pure Flying = 2×,
// Ground/Flying = 0.5 × 2 = 1×, and Steel/Flying = 0 (Steel immunity) × 2 = 0×.
// =============================================================================

import { allMoves } from "#data/data-lists";
import type { ErSuperEffectiveVsTypeAttr } from "#data/moves/move";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Poison Gas — super effective (2×) vs Flying", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("is a Special Poison damaging move after ER patches", () => {
    const move = allMoves[MoveId.POISON_GAS];
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.type).toBe(PokemonType.POISON);
    expect(move.power).toBe(65);
  });

  it("carries a type-effectiveness override (not a silent power multiplier)", () => {
    const move = allMoves[MoveId.POISON_GAS];
    expect(move.getAttrs("ErSuperEffectiveVsTypeAttr").length).toBeGreaterThan(0);
    // The old approximation is gone — no silent power doubling.
    expect(move.getAttrs("MovePowerMultiplierAttr").length).toBe(0);
  });

  it("forces the Flying component to 2× and multiplies the rest of the chart", () => {
    const move = allMoves[MoveId.POISON_GAS];
    const attr = move.getAttrs("ErSuperEffectiveVsTypeAttr")[0] as ErSuperEffectiveVsTypeAttr;
    const user = {} as never;
    const target = {} as never;

    // Pure Flying → 2× (super effective).
    const flying = new NumberHolder(1);
    const flyingHit = attr.apply(user, target, move, [flying, [PokemonType.FLYING], PokemonType.POISON]);
    expect(flyingHit).toBe(true);
    expect(flying.value).toBe(2);

    // Non-Flying target → untouched (attr declines).
    const ground = new NumberHolder(1);
    const groundHit = attr.apply(user, target, move, [ground, [PokemonType.GROUND], PokemonType.POISON]);
    expect(groundHit).toBe(false);
    expect(ground.value).toBe(1);

    // Gligar (Ground/Flying): Poison-vs-Ground (0.5×) × forced Flying (2×) = 1×.
    // This is the core regression: it must NOT floor to 2×.
    const gligar = new NumberHolder(0.5);
    attr.apply(user, target, move, [gligar, [PokemonType.GROUND, PokemonType.FLYING], PokemonType.POISON]);
    expect(gligar.value).toBe(1);

    // Skarmory (Steel/Flying): Poison-vs-Steel (0× immune) × forced Flying (2×)
    // = 0×. The non-targeted type's immunity is preserved.
    const skarmory = new NumberHolder(0);
    attr.apply(user, target, move, [skarmory, [PokemonType.STEEL, PokemonType.FLYING], PokemonType.POISON]);
    expect(skarmory.value).toBe(0);

    // The incoming value is recomputed from the chart, so a stale incoming value
    // (e.g. a leftover 4×) does not survive — Flying is forced to exactly 2×.
    const stale = new NumberHolder(4);
    attr.apply(user, target, move, [stale, [PokemonType.FLYING], PokemonType.POISON]);
    expect(stale.value).toBe(2);
  });
});

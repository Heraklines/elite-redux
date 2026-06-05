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
// game shows "It's super effective!" and the multiplier is a real 2×. This
// verifies the live built move carries that override and that it forces ≥2×
// against a Flying target while leaving non-Flying targets untouched.
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

  it("forces the type multiplier to 2× vs Flying, leaves others alone", () => {
    const move = allMoves[MoveId.POISON_GAS];
    const attr = move.getAttrs("ErSuperEffectiveVsTypeAttr")[0] as ErSuperEffectiveVsTypeAttr;
    const user = {} as never;
    const target = {} as never;

    // Flying target, currently-neutral (1×) → forced to 2× (super effective).
    const flying = new NumberHolder(1);
    attr.apply(user, target, move, [flying, [PokemonType.FLYING], PokemonType.POISON]);
    expect(flying.value).toBe(2);

    // Non-Flying target → untouched.
    const ground = new NumberHolder(1);
    attr.apply(user, target, move, [ground, [PokemonType.GROUND], PokemonType.POISON]);
    expect(ground.value).toBe(1);

    // Already more effective than 2× (e.g. 4× via another type) → not reduced.
    const quad = new NumberHolder(4);
    attr.apply(user, target, move, [quad, [PokemonType.FLYING], PokemonType.POISON]);
    expect(quad.value).toBe(4);

    // Resisted/immune (0.5× or 0×) vs Flying → still forced up to 2×.
    const resisted = new NumberHolder(0.5);
    attr.apply(user, target, move, [resisted, [PokemonType.FLYING], PokemonType.POISON]);
    expect(resisted.value).toBe(2);
  });
});

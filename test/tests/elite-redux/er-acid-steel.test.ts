/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): ER "Acid" is a 70-BP Special Poison move whose dex entry
// reads "Super effective vs Steel. Hits both foes. 30% chance to lower SpDef."
// but it "didn't work" against Steel mons (Skarmory etc.) - i.e. it did 0 (the
// Poison-vs-Steel immunity) instead of super effective. This pins that ER's
// SE-vs-Steel override is actually ATTACHED to MoveId.ACID and that it overrides
// the Steel immunity (0x -> 2x) while leaving the rest of the chart intact.
// (Sibling of er-poison-gas-flying.test; Acid targets Steel, Poison Gas Flying.)
// =============================================================================

import { allMoves } from "#data/data-lists";
import type { ErSuperEffectiveVsTypeAttr } from "#data/moves/move";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Acid — super effective (2×) vs Steel", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("carries the SE-vs-Steel type-effectiveness override after ER patches", () => {
    const move = allMoves[MoveId.ACID];
    expect(move.type).toBe(PokemonType.POISON);
    expect(move.getAttrs("ErSuperEffectiveVsTypeAttr").length).toBeGreaterThan(0);
  });

  it("forces the Steel component to 2× (overriding the immunity) and multiplies the rest", () => {
    const move = allMoves[MoveId.ACID];
    const attr = move.getAttrs("ErSuperEffectiveVsTypeAttr")[0] as ErSuperEffectiveVsTypeAttr;
    const user = {} as never;
    const target = {} as never;

    // Pure Steel (e.g. Registeel) → 2× (immunity overridden to super effective).
    const steel = new NumberHolder(0);
    const steelHit = attr.apply(user, target, move, [steel, [PokemonType.STEEL], PokemonType.POISON]);
    expect(steelHit).toBe(true);
    expect(steel.value).toBe(2);

    // Skarmory (Steel/Flying): forced Steel (2×) × Poison-vs-Flying (1×) = 2×.
    // This is the tester's exact case - it must NOT stay at 0 (the Steel immunity).
    const skarmory = new NumberHolder(0);
    attr.apply(user, target, move, [skarmory, [PokemonType.STEEL, PokemonType.FLYING], PokemonType.POISON]);
    expect(skarmory.value).toBe(2);

    // Non-Steel target → untouched (attr declines, natural chart stands).
    const water = new NumberHolder(1);
    const waterHit = attr.apply(user, target, move, [water, [PokemonType.WATER], PokemonType.POISON]);
    expect(waterHit).toBe(false);
    expect(water.value).toBe(1);

    // Steel/Ground (e.g. a hypothetical dual-type): forced Steel (2×) ×
    // Poison-vs-Ground (0.5×) = 1× - the non-targeted type's resistance survives.
    const steelGround = new NumberHolder(0);
    attr.apply(user, target, move, [steelGround, [PokemonType.STEEL, PokemonType.GROUND], PokemonType.POISON]);
    expect(steelGround.value).toBe(1);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbsorbantAbAttr } from "#data/elite-redux/archetypes/absorbant";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#types/move-types";
import { NumberHolder } from "#utils/common";
import { describe, expect, it, vi } from "vitest";

describe("AbsorbantAbAttr", () => {
  const drainMove = {
    category: 1,
    hasAttr: vi.fn((name: string) => name === "HitHealAttr"),
  } as unknown as Move;

  const ordinaryMove = {
    category: 1,
    hasAttr: vi.fn(() => false),
  } as unknown as Move;

  function params(move: Move) {
    const pokemon = { id: 1 } as Pokemon;
    const opponent = {
      canAddTag: vi.fn(() => true),
      addTag: vi.fn(),
      hasAbilityWithAttr: vi.fn(() => false),
    } as unknown as Pokemon;
    return {
      pokemon,
      opponent,
      move,
      damage: 50,
      hitResult: 0,
      simulated: false,
    };
  }

  it("multiplies drain recovery by 1.5", () => {
    const attr = new AbsorbantAbAttr();
    const multiplier = new NumberHolder(1);
    attr.fire(multiplier);
    expect(multiplier.value).toBe(1.5);
  });

  it("seeds the target after a drain move", () => {
    const attr = new AbsorbantAbAttr();
    const interaction = params(drainMove);
    expect(attr.canApply(interaction)).toBe(true);
    attr.apply(interaction);
    expect(interaction.opponent.addTag).toHaveBeenCalledWith(BattlerTagType.SEEDED, 0, undefined, 1);
  });

  it("does not trigger for a non-drain move", () => {
    const attr = new AbsorbantAbAttr();
    expect(attr.canApply(params(ordinaryMove))).toBe(false);
  });
});

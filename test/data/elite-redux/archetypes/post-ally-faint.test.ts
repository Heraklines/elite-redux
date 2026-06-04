/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostAllyFaintStatChangeAbAttr } from "#data/elite-redux/archetypes/post-ally-faint";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

describe("PostAllyFaintStatChangeAbAttr", () => {
  it("rejects empty stats", () => {
    expect(() => new PostAllyFaintStatChangeAbAttr({ stats: [] })).toThrow(/non-empty/);
  });

  it("rejects zero-stage entries", () => {
    expect(() =>
      new PostAllyFaintStatChangeAbAttr({
        stats: [{ stat: Stat.ATK, stages: 0 }],
      }),
    ).toThrow(/non-zero/);
  });

  it("accepts valid construction", () => {
    const attr = new PostAllyFaintStatChangeAbAttr({
      stats: [{ stat: Stat.ATK, stages: 1 }],
    });
    expect(attr).toBeInstanceOf(PostAllyFaintStatChangeAbAttr);
  });

  it("accepts multi-stat construction", () => {
    const attr = new PostAllyFaintStatChangeAbAttr({
      stats: [
        { stat: Stat.ATK, stages: 1 },
        { stat: Stat.SPATK, stages: 1 },
        { stat: Stat.SPDEF, stages: 1 },
      ],
    });
    expect(attr).toBeInstanceOf(PostAllyFaintStatChangeAbAttr);
  });

  describe("canApply", () => {
    const attr = new PostAllyFaintStatChangeAbAttr({
      stats: [{ stat: Stat.ATK, stages: 1 }],
    });

    it("returns false when victim is the holder", () => {
      const holder = { id: 1, isPlayer: () => true };
      const params = { pokemon: holder, victim: holder } as never;
      expect(attr.canApply(params)).toBe(false);
    });

    it("returns false when victim is on the opposing side", () => {
      const holder = { id: 1, isPlayer: () => true };
      const enemyVictim = { id: 2, isPlayer: () => false };
      const params = { pokemon: holder, victim: enemyVictim } as never;
      expect(attr.canApply(params)).toBe(false);
    });

    it("returns true when victim is an ally (same side, different id)", () => {
      const holder = { id: 1, isPlayer: () => true };
      const allyVictim = { id: 2, isPlayer: () => true };
      const params = { pokemon: holder, victim: allyVictim } as never;
      expect(attr.canApply(params)).toBe(true);
    });

    it("respects the player/enemy side symmetrically", () => {
      const enemyHolder = { id: 1, isPlayer: () => false };
      const enemyAlly = { id: 2, isPlayer: () => false };
      const params = { pokemon: enemyHolder, victim: enemyAlly } as never;
      expect(attr.canApply(params)).toBe(true);
    });
  });
});

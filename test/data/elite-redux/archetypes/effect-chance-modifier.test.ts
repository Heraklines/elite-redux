/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: tests for the `effect-chance-modifier` archetype.
//
// Thin wrapper around pokerogue's `MoveEffectChanceMultiplierAbAttr`. The
// parent's apply path multiplies a `NumberHolder.chance` and clamps to ≤ 100;
// we exercise the multiplication / clamping plus construction validation.
// =============================================================================

import { EffectChanceModifierAbAttr } from "#data/elite-redux/archetypes/effect-chance-modifier";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeStubMove(opts: { id?: MoveId } = {}): Move {
  return {
    id: opts.id ?? MoveId.TACKLE,
  } as unknown as Move;
}

function runMod(opts: { attr: EffectChanceModifierAbAttr; initialChance: number; move?: Move }) {
  const chance = new NumberHolder(opts.initialChance);
  const params = {
    pokemon: { id: 1 },
    chance,
    move: opts.move ?? makeStubMove(),
    simulated: false,
  } as unknown as Parameters<EffectChanceModifierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalChance: chance.value };
}

describe("EffectChanceModifierAbAttr archetype (C1d)", () => {
  describe("Serene-Grace-style amplifier", () => {
    it("doubles a 30% chance to 60%", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 2 });
      const result = runMod({ attr, initialChance: 30 });
      expect(result.fired).toBe(true);
      expect(result.finalChance).toBe(60);
    });

    it("clamps post-multiplication to ≤ 100", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 4 });
      const result = runMod({ attr, initialChance: 30 });
      // 30 * 4 = 120 → clamped to 100
      expect(result.finalChance).toBe(100);
    });
  });

  describe("Sheer-Force-style chance strip", () => {
    it("multiplier=0 strips the chance to 0", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 0 });
      const result = runMod({ attr, initialChance: 30 });
      expect(result.fired).toBe(true);
      expect(result.finalChance).toBe(0);
    });

    it("stripsSecondaryEffects() returns true for multiplier=0", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 0 });
      expect(attr.stripsSecondaryEffects()).toBe(true);
    });

    it("stripsSecondaryEffects() returns false for multiplier > 0", () => {
      expect(new EffectChanceModifierAbAttr({ multiplier: 1 }).stripsSecondaryEffects()).toBe(false);
      expect(new EffectChanceModifierAbAttr({ multiplier: 2 }).stripsSecondaryEffects()).toBe(false);
    });
  });

  describe("canApply gating (inherited)", () => {
    it("does NOT fire when initial chance is 0", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 2 });
      const result = runMod({ attr, initialChance: 0 });
      // Parent: `chance.value <= 0` short-circuits, canApply returns false
      expect(result.fired).toBe(false);
      expect(result.finalChance).toBe(0);
    });

    it("does NOT fire for ORDER_UP (parent's hardcoded exception list)", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 2 });
      const result = runMod({ attr, initialChance: 30, move: makeStubMove({ id: MoveId.ORDER_UP }) });
      expect(result.fired).toBe(false);
    });

    it("does NOT fire for ELECTRO_SHOT (parent's hardcoded exception list)", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 2 });
      const result = runMod({ attr, initialChance: 30, move: makeStubMove({ id: MoveId.ELECTRO_SHOT }) });
      expect(result.fired).toBe(false);
    });
  });

  describe("fractional multipliers", () => {
    it("halves a 60% chance to 30%", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 0.5 });
      const result = runMod({ attr, initialChance: 60 });
      expect(result.finalChance).toBe(30);
    });
  });

  describe("accessors", () => {
    it("exposes the configured multiplier", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 2.5 });
      expect(attr.getMultiplier()).toBe(2.5);
    });
  });

  describe("validation", () => {
    it("rejects negative multiplier", () => {
      expect(() => new EffectChanceModifierAbAttr({ multiplier: -0.5 })).toThrow(/must be ≥ 0/);
    });

    it("accepts multiplier = 0 (Sheer Force)", () => {
      expect(() => new EffectChanceModifierAbAttr({ multiplier: 0 })).not.toThrow();
    });

    it("accepts multiplier = 1 (no-op)", () => {
      expect(() => new EffectChanceModifierAbAttr({ multiplier: 1 })).not.toThrow();
    });

    it("rejects NaN multiplier", () => {
      expect(() => new EffectChanceModifierAbAttr({ multiplier: Number.NaN })).toThrow(/must be ≥ 0/);
    });
  });

  describe("flag gate (Precise Fist — punching-only 5x)", () => {
    function makeFlaggedMove(hasPunch: boolean): Move {
      return {
        id: MoveId.MACH_PUNCH,
        hasFlag: (flag: MoveFlags) => hasPunch && flag === MoveFlags.PUNCHING_MOVE,
      } as unknown as Move;
    }

    it("amplifies effect chance for a move carrying the gated flag", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 5, flag: MoveFlags.PUNCHING_MOVE });
      const result = runMod({ attr, initialChance: 10, move: makeFlaggedMove(true) });
      expect(result.fired).toBe(true);
      expect(result.finalChance).toBe(50);
    });

    it("does NOT fire for a move missing the gated flag", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 5, flag: MoveFlags.PUNCHING_MOVE });
      const result = runMod({ attr, initialChance: 10, move: makeFlaggedMove(false) });
      expect(result.fired).toBe(false);
      expect(result.finalChance).toBe(10); // unchanged
    });

    it("exposes the configured flag", () => {
      const attr = new EffectChanceModifierAbAttr({ multiplier: 5, flag: MoveFlags.PUNCHING_MOVE });
      expect(attr.getFlag()).toBe(MoveFlags.PUNCHING_MOVE);
    });
  });
});

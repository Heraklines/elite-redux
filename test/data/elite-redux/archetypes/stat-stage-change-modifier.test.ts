/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: tests for `stat-stage-change-modifier`
// archetype.
//
// Thin wrapper around pokerogue's `StatStageChangeMultiplierAbAttr`. The
// parent's `apply` multiplies the `numStages.value` holder; we exercise the
// multiplication plus construction validation and helper accessors.
// =============================================================================

import { StatStageChangeModifierAbAttr } from "#data/elite-redux/archetypes/stat-stage-change-modifier";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function runMultiplier(opts: { attr: StatStageChangeModifierAbAttr; initialStages: number }): {
  fired: boolean;
  finalStages: number;
} {
  const numStages = new NumberHolder(opts.initialStages);
  const params = {
    pokemon: { id: 1 },
    numStages,
    simulated: true,
  } as unknown as Parameters<StatStageChangeModifierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalStages: numStages.value };
}

describe("StatStageChangeModifierAbAttr archetype (C1e)", () => {
  describe("Simple-style amplifier (multiplier = 2)", () => {
    it("doubles a +1 boost to +2", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: 2 });
      const result = runMultiplier({ attr, initialStages: 1 });
      expect(result.fired).toBe(true);
      expect(result.finalStages).toBe(2);
    });

    it("doubles a -1 drop to -2", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: 2 });
      const result = runMultiplier({ attr, initialStages: -1 });
      expect(result.finalStages).toBe(-2);
    });

    it("doubles a +3 boost to +6", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: 2 });
      const result = runMultiplier({ attr, initialStages: 3 });
      expect(result.finalStages).toBe(6);
    });
  });

  describe("Contrary-style inverter (multiplier = -1)", () => {
    it("flips a +1 boost to -1 (drop)", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: -1 });
      const result = runMultiplier({ attr, initialStages: 1 });
      expect(result.finalStages).toBe(-1);
    });

    it("flips a -2 drop to +2 (boost)", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: -1 });
      const result = runMultiplier({ attr, initialStages: -2 });
      expect(result.finalStages).toBe(2);
    });

    it("invertsDirection() returns true for negative multiplier", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: -1 }).invertsDirection()).toBe(true);
    });

    it("invertsDirection() returns false for positive multiplier", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: 2 }).invertsDirection()).toBe(false);
    });
  });

  describe("fractional / partial multipliers", () => {
    it("halves a +2 boost to +1 (fractional ER custom)", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: 0.5 });
      const result = runMultiplier({ attr, initialStages: 2 });
      expect(result.finalStages).toBe(1);
    });

    it("halves a -4 drop to -2", () => {
      const attr = new StatStageChangeModifierAbAttr({ multiplier: 0.5 });
      const result = runMultiplier({ attr, initialStages: -4 });
      expect(result.finalStages).toBe(-2);
    });
  });

  describe("amplifies() helper", () => {
    it("returns true for Simple (multiplier=2)", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: 2 }).amplifies()).toBe(true);
    });

    it("returns false for Contrary (multiplier=-1, |m|=1)", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: -1 }).amplifies()).toBe(false);
    });

    it("returns false for fractional (multiplier=0.5)", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: 0.5 }).amplifies()).toBe(false);
    });

    it("returns true for ER custom amplifier (multiplier=3)", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: 3 }).amplifies()).toBe(true);
    });
  });

  describe("accessors", () => {
    it("exposes the configured multiplier", () => {
      expect(new StatStageChangeModifierAbAttr({ multiplier: 2 }).getMultiplier()).toBe(2);
      expect(new StatStageChangeModifierAbAttr({ multiplier: -1 }).getMultiplier()).toBe(-1);
      expect(new StatStageChangeModifierAbAttr({ multiplier: 0.5 }).getMultiplier()).toBe(0.5);
    });
  });

  describe("validation", () => {
    it("rejects multiplier = 0 (use ProtectStat for full block)", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: 0 })).toThrow(/must not be 0/);
    });

    it("rejects multiplier = 1 (no-op)", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: 1 })).toThrow(/must not be 1/);
    });

    it("rejects NaN multiplier", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: Number.NaN })).toThrow(/must be finite/);
    });

    it("rejects Infinity", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: Number.POSITIVE_INFINITY })).toThrow(
        /must be finite/,
      );
    });

    it("accepts ER fractional multiplier (0.5)", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: 0.5 })).not.toThrow();
    });

    it("accepts -2 (inverter + amplifier hybrid)", () => {
      expect(() => new StatStageChangeModifierAbAttr({ multiplier: -2 })).not.toThrow();
    });
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 7 / Phase C late-addition: tests for the
// `weather-stat-multiplier` archetype.
//
// The archetype's canApply checks two predicates:
//   1. Parent stat-match (from {@linkcode StatMultiplierAbAttr.canApply}).
//   2. Active weather is one of the configured weathers, AND the weather
//      effect is not suppressed.
//
// We exercise both predicates via stubbed `globalScene.arena` (matching the
// sibling `weather-terrain-interaction.test.ts` setup) and stubbed `Pokemon`
// / `Move` shells.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Initialize the global scene with a minimal `arena` stub. Tests drive the
 * weather predicate by varying the active weather type and the
 * `isEffectSuppressed()` flag.
 */
function mockArena(opts: { weatherType: WeatherType; suppressed?: boolean }): void {
  const weather =
    opts.weatherType === WeatherType.NONE
      ? undefined
      : { weatherType: opts.weatherType, isEffectSuppressed: () => opts.suppressed ?? false };
  initGlobalScene({
    arena: {
      weatherType: opts.weatherType,
      weather,
    },
  } as unknown as BattleScene);
}

function makeStubParams(opts: { stat: Stat; statVal?: number }) {
  return {
    pokemon: {} as unknown as Pokemon,
    move: {} as unknown as Move,
    stat: opts.stat,
    statVal: new NumberHolder(opts.statVal ?? 100),
    simulated: false,
  } as unknown as Parameters<WeatherStatMultiplierAbAttr["canApply"]>[0];
}

describe("WeatherStatMultiplierAbAttr archetype (Round 7)", () => {
  beforeEach(() => {
    mockArena({ weatherType: WeatherType.NONE });
  });

  describe("construction validation", () => {
    it("rejects multiplier <= 0", () => {
      expect(
        () => new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 0, weathers: [WeatherType.RAIN] }),
      ).toThrow(/multiplier must be > 0/);
      expect(
        () => new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: -1, weathers: [WeatherType.RAIN] }),
      ).toThrow(/multiplier must be > 0/);
    });

    it("rejects empty weathers list", () => {
      expect(() => new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5, weathers: [] })).toThrow(
        /must configure at least one weather type/,
      );
    });

    it("rejects WeatherType.NONE in weathers list", () => {
      expect(
        () =>
          new WeatherStatMultiplierAbAttr({
            stat: Stat.SPD,
            multiplier: 1.5,
            weathers: [WeatherType.SUNNY, WeatherType.NONE],
          }),
      ).toThrow(/weathers must not include NONE/);
    });

    it("accepts a valid full payload (Thermal Slide shape)", () => {
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 1.5,
        weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.HAIL, WeatherType.SNOW],
      });
      expect(attr.stat).toBe(Stat.SPD);
      expect(attr.multiplier).toBe(1.5);
      expect(attr.getWeathers()).toEqual([
        WeatherType.SUNNY,
        WeatherType.HARSH_SUN,
        WeatherType.HAIL,
        WeatherType.SNOW,
      ]);
    });
  });

  describe("canApply weather gate", () => {
    const buildAttr = () =>
      new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 1.5,
        weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.HAIL, WeatherType.SNOW],
      });

    it("fires under SUNNY when the stat matches", () => {
      mockArena({ weatherType: WeatherType.SUNNY });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(true);
    });

    it("fires under HARSH_SUN when the stat matches", () => {
      mockArena({ weatherType: WeatherType.HARSH_SUN });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(true);
    });

    it("fires under HAIL when the stat matches", () => {
      mockArena({ weatherType: WeatherType.HAIL });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(true);
    });

    it("fires under SNOW when the stat matches", () => {
      mockArena({ weatherType: WeatherType.SNOW });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(true);
    });

    it("does NOT fire under an unrelated weather (RAIN)", () => {
      mockArena({ weatherType: WeatherType.RAIN });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(false);
    });

    it("does NOT fire when no weather is active", () => {
      mockArena({ weatherType: WeatherType.NONE });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(false);
    });

    it("does NOT fire when the active weather is effect-suppressed (Cloud Nine)", () => {
      mockArena({ weatherType: WeatherType.SUNNY, suppressed: true });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.SPD }))).toBe(false);
    });

    it("does NOT fire when the stat does not match the configured stat", () => {
      mockArena({ weatherType: WeatherType.SUNNY });
      expect(buildAttr().canApply(makeStubParams({ stat: Stat.ATK }))).toBe(false);
    });
  });

  describe("apply multiplies the stat", () => {
    it("multiplies statVal by the configured multiplier (Thermal Slide: 100 -> 150)", () => {
      mockArena({ weatherType: WeatherType.SUNNY });
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 1.5,
        weathers: [WeatherType.SUNNY],
      });
      const params = makeStubParams({ stat: Stat.SPD, statVal: 100 });
      attr.apply(params);
      // Cast to access `statVal` field; the params object is opaque in canApply
      // contract but the statVal NumberHolder is the underlying store.
      const statVal = (params as unknown as { statVal: NumberHolder }).statVal;
      expect(statVal.value).toBe(150);
    });

    it("supports debuff multipliers < 1", () => {
      mockArena({ weatherType: WeatherType.HAIL });
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 0.5,
        weathers: [WeatherType.HAIL],
      });
      const params = makeStubParams({ stat: Stat.SPD, statVal: 200 });
      attr.apply(params);
      const statVal = (params as unknown as { statVal: NumberHolder }).statVal;
      expect(statVal.value).toBe(100);
    });
  });

  describe("isWeatherActive helper", () => {
    it("returns true when active weather is in the list and not suppressed", () => {
      mockArena({ weatherType: WeatherType.RAIN });
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 2,
        weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
      });
      expect(attr.isWeatherActive()).toBe(true);
    });

    it("returns false when active weather is suppressed", () => {
      mockArena({ weatherType: WeatherType.RAIN, suppressed: true });
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 2,
        weathers: [WeatherType.RAIN],
      });
      expect(attr.isWeatherActive()).toBe(false);
    });

    it("returns false when active weather is not in the configured list", () => {
      mockArena({ weatherType: WeatherType.SANDSTORM });
      const attr = new WeatherStatMultiplierAbAttr({
        stat: Stat.SPD,
        multiplier: 2,
        weathers: [WeatherType.RAIN],
      });
      expect(attr.isWeatherActive()).toBe(false);
    });
  });
});

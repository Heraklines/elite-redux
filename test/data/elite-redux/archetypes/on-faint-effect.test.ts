/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: tests for the `on-faint-effect` archetype.
//
// 4-way discriminated effect union (set-weather / set-terrain /
// attacker-damage-flat / set-hazard). Tests cover construction validation,
// accessor invariants, and the simulated-apply no-op path. globalScene-
// dependent apply paths are deferred to later integration work.
// =============================================================================

import { type OnFaintEffect, OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { WeatherType } from "#enums/weather-type";
import { describe, expect, it } from "vitest";

describe("OnFaintEffectAbAttr — construction validation", () => {
  it("constructs with set-weather effect", () => {
    const attr = new OnFaintEffectAbAttr({
      effect: { kind: "set-weather", weather: WeatherType.SANDSTORM },
    });
    expect(attr.getKind()).toBe("set-weather");
    expect(attr.getEffect()).toEqual({ kind: "set-weather", weather: WeatherType.SANDSTORM });
  });

  it("constructs with set-terrain effect", () => {
    const attr = new OnFaintEffectAbAttr({
      effect: { kind: "set-terrain", terrain: TerrainType.GRASSY },
    });
    expect(attr.getKind()).toBe("set-terrain");
  });

  it("constructs with attacker-damage-flat effect", () => {
    const attr = new OnFaintEffectAbAttr({
      effect: { kind: "attacker-damage-flat", maxHpFraction: 0.25 },
    });
    expect(attr.getKind()).toBe("attacker-damage-flat");
    const effect = attr.getEffect();
    expect(effect.kind === "attacker-damage-flat" && effect.maxHpFraction).toBe(0.25);
  });

  it("constructs with set-hazard effect (default layers=1)", () => {
    const attr = new OnFaintEffectAbAttr({
      effect: { kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK },
    });
    expect(attr.getKind()).toBe("set-hazard");
  });

  it("constructs with set-hazard effect (multi-layer)", () => {
    const attr = new OnFaintEffectAbAttr({
      effect: { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: 3 },
    });
    expect(attr.getKind()).toBe("set-hazard");
    const effect = attr.getEffect();
    expect(effect.kind === "set-hazard" && effect.layers).toBe(3);
  });

  it("rejects set-weather with WeatherType.NONE", () => {
    // unplugin-inline-enum replaces `WeatherType.NONE` with 0 in the source
    // string at build time; match the substring that survives inlining.
    expect(() => new OnFaintEffectAbAttr({ effect: { kind: "set-weather", weather: WeatherType.NONE } })).toThrow(
      /set-weather effect cannot use/,
    );
  });

  it("rejects attacker-damage-flat with maxHpFraction = 0", () => {
    expect(() => new OnFaintEffectAbAttr({ effect: { kind: "attacker-damage-flat", maxHpFraction: 0 } })).toThrow(
      /maxHpFraction must be in \(0, 1\]/,
    );
  });

  it("rejects attacker-damage-flat with maxHpFraction > 1", () => {
    expect(() => new OnFaintEffectAbAttr({ effect: { kind: "attacker-damage-flat", maxHpFraction: 1.5 } })).toThrow(
      /maxHpFraction must be in \(0, 1\]/,
    );
  });

  it("rejects attacker-damage-flat with negative maxHpFraction", () => {
    expect(() => new OnFaintEffectAbAttr({ effect: { kind: "attacker-damage-flat", maxHpFraction: -0.5 } })).toThrow(
      /maxHpFraction must be in \(0, 1\]/,
    );
  });

  it("accepts attacker-damage-flat with maxHpFraction = 1 (boundary)", () => {
    expect(() => new OnFaintEffectAbAttr({ effect: { kind: "attacker-damage-flat", maxHpFraction: 1 } })).not.toThrow();
  });

  it("rejects set-hazard with zero layers", () => {
    expect(
      () =>
        new OnFaintEffectAbAttr({
          effect: { kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK, layers: 0 },
        }),
    ).toThrow(/positive integer/);
  });

  it("rejects set-hazard with negative layers", () => {
    expect(
      () =>
        new OnFaintEffectAbAttr({
          effect: { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: -1 },
        }),
    ).toThrow(/positive integer/);
  });

  it("rejects set-hazard with non-integer layers", () => {
    expect(
      () =>
        new OnFaintEffectAbAttr({
          effect: { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: 1.5 },
        }),
    ).toThrow(/positive integer/);
  });
});

describe("OnFaintEffectAbAttr — accessors", () => {
  it("getKind returns the discriminator string", () => {
    const variants: { effect: OnFaintEffect; expected: string }[] = [
      { effect: { kind: "set-weather", weather: WeatherType.SUNNY }, expected: "set-weather" },
      { effect: { kind: "set-terrain", terrain: TerrainType.MISTY }, expected: "set-terrain" },
      { effect: { kind: "attacker-damage-flat", maxHpFraction: 0.5 }, expected: "attacker-damage-flat" },
      { effect: { kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK }, expected: "set-hazard" },
    ];
    for (const v of variants) {
      const attr = new OnFaintEffectAbAttr({ effect: v.effect });
      expect(attr.getKind()).toBe(v.expected);
    }
  });

  it("getEffect returns the configured effect verbatim", () => {
    const effect: OnFaintEffect = { kind: "set-weather", weather: WeatherType.RAIN };
    const attr = new OnFaintEffectAbAttr({ effect });
    expect(attr.getEffect()).toBe(effect);
  });
});

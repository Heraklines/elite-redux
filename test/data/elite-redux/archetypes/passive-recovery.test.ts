/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: tests for the `passive-recovery` archetype.
//
// Single-class archetype that extends pokerogue's `PostTurnHealAbAttr`. Tests
// cover the parent's "not at full HP" gate, each condition kind (`always`,
// `status`, `weather`, `terrain`), construction validation, and accessors.
//
// We stub `globalScene` via `initGlobalScene` to drive the weather / terrain
// gates without spinning up a real arena.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { beforeEach, describe, expect, it } from "vitest";

function makeStubPokemon(
  opts: { fullHp?: boolean; status?: StatusEffect; hp?: number; maxHp?: number; comatose?: boolean } = {},
): Pokemon {
  return {
    isFullHp: () => opts.fullHp ?? false,
    status: opts.status === undefined ? null : { effect: opts.status },
    hp: opts.hp ?? 50,
    getMaxHp: () => opts.maxHp ?? 100,
    // The SLEEP-gated condition (Sweet Dreams) also fires for Comatose holders,
    // so matchesCondition consults hasAbility(COMATOSE) — the stub must provide it.
    hasAbility: (id: AbilityId) => (opts.comatose ?? false) && id === AbilityId.COMATOSE,
    getTypes: () => [],
  } as unknown as Pokemon;
}

function mockArena(opts: { weatherType?: WeatherType; terrainType?: TerrainType } = {}): void {
  initGlobalScene({
    arena: {
      weatherType: opts.weatherType ?? WeatherType.NONE,
      terrainType: opts.terrainType ?? TerrainType.NONE,
    },
  } as unknown as BattleScene);
}

function runCanApply(opts: { attr: PassiveRecoveryAbAttr; pokemon: Pokemon }): boolean {
  const params = {
    pokemon: opts.pokemon,
    simulated: true,
  } as unknown as Parameters<PassiveRecoveryAbAttr["canApply"]>[0];
  return opts.attr.canApply(params);
}

describe("PassiveRecoveryAbAttr archetype (C1e)", () => {
  beforeEach(() => {
    mockArena();
  });

  describe("parent's full-HP gate (inherited)", () => {
    it("does NOT fire when the user is at full HP", () => {
      const attr = new PassiveRecoveryAbAttr({ healFraction: 1 / 16 });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ fullHp: true }) })).toBe(false);
    });

    it("fires when the user is below full HP", () => {
      const attr = new PassiveRecoveryAbAttr({ healFraction: 1 / 16 });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ fullHp: false }) })).toBe(true);
    });
  });

  describe("condition — always", () => {
    it("fires regardless of status / weather / terrain", () => {
      const attr = new PassiveRecoveryAbAttr({ healFraction: 1 / 8 });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(true);
    });
  });

  describe("condition — status", () => {
    it("fires only when the configured status is active (Sweet-Dreams-style)", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 8,
        condition: { kind: "status", status: StatusEffect.SLEEP },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ status: StatusEffect.SLEEP }) })).toBe(true);
    });

    it("does NOT fire when the status differs", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 8,
        condition: { kind: "status", status: StatusEffect.SLEEP },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ status: StatusEffect.POISON }) })).toBe(false);
    });

    it("does NOT fire when no status is active", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 8,
        condition: { kind: "status", status: StatusEffect.SLEEP },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(false);
    });

    it("SLEEP gate ALSO fires for a Comatose holder with no real status (Peaceful Slumber #490)", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 8,
        condition: { kind: "status", status: StatusEffect.SLEEP },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ comatose: true }) })).toBe(true);
    });
  });

  describe("condition — weather", () => {
    it("fires when the configured weather is active", () => {
      mockArena({ weatherType: WeatherType.RAIN });
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 16,
        condition: { kind: "weather", weathers: [WeatherType.RAIN] },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(true);
    });

    it("does NOT fire when weather differs", () => {
      mockArena({ weatherType: WeatherType.SUNNY });
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 16,
        condition: { kind: "weather", weathers: [WeatherType.RAIN] },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(false);
    });

    it("supports OR semantics across multi-weather configurations (Ice Body / hail+snow)", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 16,
        condition: { kind: "weather", weathers: [WeatherType.HAIL, WeatherType.SNOW] },
      });
      mockArena({ weatherType: WeatherType.HAIL });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(true);
      mockArena({ weatherType: WeatherType.SNOW });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(true);
      mockArena({ weatherType: WeatherType.SUNNY });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(false);
    });
  });

  describe("condition — terrain", () => {
    it("fires when the configured terrain is active", () => {
      mockArena({ terrainType: TerrainType.GRASSY });
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 16,
        condition: { kind: "terrain", terrains: [TerrainType.GRASSY] },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(true);
    });

    it("does NOT fire when terrain differs", () => {
      mockArena({ terrainType: TerrainType.ELECTRIC });
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 16,
        condition: { kind: "terrain", terrains: [TerrainType.GRASSY] },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon() })).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured heal fraction and condition", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 4,
        condition: { kind: "status", status: StatusEffect.SLEEP },
      });
      expect(attr.getHealFraction()).toBe(1 / 4);
      expect(attr.getRecoveryCondition()).toEqual({ kind: "status", status: StatusEffect.SLEEP });
    });

    it("defaults condition to always when omitted", () => {
      const attr = new PassiveRecoveryAbAttr({ healFraction: 1 / 16 });
      expect(attr.getRecoveryCondition()).toEqual({ kind: "always" });
    });
  });

  describe("validation", () => {
    it("rejects healFraction = 0", () => {
      expect(() => new PassiveRecoveryAbAttr({ healFraction: 0 })).toThrow(/must be in/);
    });

    it("rejects negative healFraction", () => {
      expect(() => new PassiveRecoveryAbAttr({ healFraction: -0.1 })).toThrow(/must be in/);
    });

    it("rejects healFraction > 1", () => {
      expect(() => new PassiveRecoveryAbAttr({ healFraction: 1.5 })).toThrow(/must be in/);
    });

    it("accepts healFraction = 1 (max boundary)", () => {
      expect(() => new PassiveRecoveryAbAttr({ healFraction: 1 })).not.toThrow();
    });

    it("rejects hp-below-fraction with fraction = 0", () => {
      expect(
        () =>
          new PassiveRecoveryAbAttr({
            healFraction: 1 / 4,
            condition: { kind: "hp-below-fraction", fraction: 0 },
          }),
      ).toThrow(/hp-below-fraction must be in/);
    });

    it("rejects hp-below-fraction with fraction = 1 (must be < 1)", () => {
      expect(
        () =>
          new PassiveRecoveryAbAttr({
            healFraction: 1 / 4,
            condition: { kind: "hp-below-fraction", fraction: 1 },
          }),
      ).toThrow(/hp-below-fraction must be in/);
    });
  });

  describe("condition — hp-below-fraction (Resilience)", () => {
    it("fires when current HP <= maxHp * fraction", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 4,
        condition: { kind: "hp-below-fraction", fraction: 0.5 },
      });
      // 50/100 — boundary; threshold is inclusive so fires.
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ hp: 50, maxHp: 100 }) })).toBe(true);
    });

    it("fires when current HP well below threshold", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 4,
        condition: { kind: "hp-below-fraction", fraction: 0.5 },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ hp: 10, maxHp: 100 }) })).toBe(true);
    });

    it("does NOT fire when current HP exceeds threshold", () => {
      const attr = new PassiveRecoveryAbAttr({
        healFraction: 1 / 4,
        condition: { kind: "hp-below-fraction", fraction: 0.5 },
      });
      expect(runCanApply({ attr, pokemon: makeStubPokemon({ hp: 75, maxHp: 100 }) })).toBe(false);
    });
  });
});

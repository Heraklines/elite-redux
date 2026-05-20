/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: tests for the `weather-terrain-interaction`
// archetype subclasses.
//
// We exercise each of the four subclasses directly:
//   - `SetWeatherOnEntryAbAttr`        — verify it forwards weather to the parent
//   - `SetTerrainOnEntryAbAttr`        — verify it forwards terrain to the parent
//   - `WeatherTypeBoostAbAttr`         — verify the type + weather gate
//   - `WeatherDamageReductionAbAttr`   — verify the weather gate + damage mult
//
// The two on-entry subclasses are mostly typed-options wrappers around
// pokerogue's existing setters; we test construction + accessor surfaces (the
// parent's apply path is verified by pokerogue's own tests).
//
// The boost/reduction subclasses depend on `globalScene.arena.weatherType` and
// `globalScene.arena.weather?.isEffectSuppressed()` — we stub those via
// `initGlobalScene` to drive the gating predicate without spinning up a real
// arena.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import {
  SetTerrainOnEntryAbAttr,
  SetWeatherOnEntryAbAttr,
  WeatherDamageReductionAbAttr,
  WeatherTypeBoostAbAttr,
} from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { TerrainType } from "#data/terrain";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Initialize the global scene with a minimal `arena` stub that exposes
 * `weatherType` + `weather?.isEffectSuppressed()`. Tests use this to drive
 * the boost / reduction gates.
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

function makeStubPokemon(): Pokemon {
  return {
    getMoveType: (move: Move) => (move as unknown as { type: PokemonType }).type,
  } as unknown as Pokemon;
}

function makeStubMove(type: PokemonType): Move {
  return { type } as unknown as Move;
}

describe("SetWeatherOnEntryAbAttr archetype (C1c)", () => {
  it("constructs with a valid weather", () => {
    const attr = new SetWeatherOnEntryAbAttr({ weather: WeatherType.RAIN });
    // The parent class exposes weatherType as a public readonly field.
    expect(attr.weatherType).toBe(WeatherType.RAIN);
  });

  it("rejects WeatherType.NONE at construction time", () => {
    expect(() => new SetWeatherOnEntryAbAttr({ weather: WeatherType.NONE })).toThrow(/weather must not be NONE/);
  });

  it("supports each canonical setter weather", () => {
    for (const weather of [
      WeatherType.SUNNY,
      WeatherType.RAIN,
      WeatherType.SANDSTORM,
      WeatherType.HAIL,
      WeatherType.SNOW,
      WeatherType.FOG,
    ]) {
      const attr = new SetWeatherOnEntryAbAttr({ weather });
      expect(attr.weatherType).toBe(weather);
    }
  });
});

describe("SetTerrainOnEntryAbAttr archetype (C1c)", () => {
  it("constructs with a valid terrain", () => {
    const attr = new SetTerrainOnEntryAbAttr({ terrain: TerrainType.ELECTRIC });
    expect(attr.getTerrain()).toBe(TerrainType.ELECTRIC);
  });

  it("supports each canonical terrain", () => {
    for (const terrain of [TerrainType.ELECTRIC, TerrainType.GRASSY, TerrainType.MISTY, TerrainType.PSYCHIC]) {
      const attr = new SetTerrainOnEntryAbAttr({ terrain });
      expect(attr.getTerrain()).toBe(terrain);
    }
  });
});

describe("WeatherTypeBoostAbAttr archetype (C1c)", () => {
  /** Run canApply + apply against the configured weather state, return final power. */
  function runBoost(opts: { attr: WeatherTypeBoostAbAttr; moveType: PokemonType; initialPower?: number }): {
    fired: boolean;
    finalPower: number;
  } {
    const power = new NumberHolder(opts.initialPower ?? 100);
    const params = {
      pokemon: makeStubPokemon(),
      opponent: makeStubPokemon(),
      move: makeStubMove(opts.moveType),
      power,
      simulated: true,
    } as unknown as Parameters<WeatherTypeBoostAbAttr["apply"]>[0];
    const canFire = opts.attr.canApply(params);
    if (canFire) {
      opts.attr.apply(params);
    }
    return { fired: canFire, finalPower: power.value };
  }

  it("fires when weather is active AND move type matches", () => {
    mockArena({ weatherType: WeatherType.RAIN });
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.RAIN],
      type: PokemonType.WATER,
      multiplier: 1.5,
    });
    const result = runBoost({ attr, moveType: PokemonType.WATER });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBe(150);
  });

  it("does NOT fire when weather differs from configured set", () => {
    mockArena({ weatherType: WeatherType.SUNNY });
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.RAIN],
      type: PokemonType.WATER,
      multiplier: 1.5,
    });
    expect(runBoost({ attr, moveType: PokemonType.WATER }).fired).toBe(false);
  });

  it("does NOT fire when move type differs", () => {
    mockArena({ weatherType: WeatherType.RAIN });
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.RAIN],
      type: PokemonType.WATER,
      multiplier: 1.5,
    });
    expect(runBoost({ attr, moveType: PokemonType.FIRE }).fired).toBe(false);
  });

  it("respects weather suppression", () => {
    mockArena({ weatherType: WeatherType.RAIN, suppressed: true });
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.RAIN],
      type: PokemonType.WATER,
      multiplier: 1.5,
    });
    expect(runBoost({ attr, moveType: PokemonType.WATER }).fired).toBe(false);
  });

  it("supports OR semantics across multi-weather configurations", () => {
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.HAIL, WeatherType.SNOW],
      type: PokemonType.ICE,
      multiplier: 1.5,
    });
    mockArena({ weatherType: WeatherType.HAIL });
    expect(runBoost({ attr, moveType: PokemonType.ICE }).fired).toBe(true);
    mockArena({ weatherType: WeatherType.SNOW });
    expect(runBoost({ attr, moveType: PokemonType.ICE }).fired).toBe(true);
    mockArena({ weatherType: WeatherType.SUNNY });
    expect(runBoost({ attr, moveType: PokemonType.ICE }).fired).toBe(false);
  });

  it("exposes its configuration via accessors", () => {
    const attr = new WeatherTypeBoostAbAttr({
      weathers: [WeatherType.SANDSTORM],
      type: PokemonType.ROCK,
      multiplier: 1.3,
    });
    expect(attr.getWeathers()).toEqual([WeatherType.SANDSTORM]);
    expect(attr.getBoostType()).toBe(PokemonType.ROCK);
    expect(attr.getMultiplier()).toBe(1.3);
  });

  it("rejects bad configurations at construction time", () => {
    expect(
      () => new WeatherTypeBoostAbAttr({ weathers: [WeatherType.RAIN], type: PokemonType.WATER, multiplier: 0 }),
    ).toThrow(/multiplier must be > 0/);
    expect(() => new WeatherTypeBoostAbAttr({ weathers: [], type: PokemonType.WATER, multiplier: 1.5 })).toThrow(
      /weathers must include at least one/,
    );
  });
});

describe("WeatherDamageReductionAbAttr archetype (C1c)", () => {
  /** Run canApply + apply, return final damage. */
  function runReduce(opts: { attr: WeatherDamageReductionAbAttr; initialDamage?: number }): {
    fired: boolean;
    finalDamage: number;
  } {
    const damage = new NumberHolder(opts.initialDamage ?? 100);
    const params = {
      pokemon: makeStubPokemon(),
      opponent: makeStubPokemon(),
      move: makeStubMove(PokemonType.NORMAL),
      damage,
      simulated: true,
    } as unknown as Parameters<WeatherDamageReductionAbAttr["apply"]>[0];
    const canFire = opts.attr.canApply(params);
    if (canFire) {
      opts.attr.apply(params);
    }
    return { fired: canFire, finalDamage: damage.value };
  }

  beforeEach(() => {
    // Default to no weather; individual tests override as needed.
    mockArena({ weatherType: WeatherType.NONE });
  });

  it("Christmas-Spirit-style: halves damage in hail", () => {
    mockArena({ weatherType: WeatherType.HAIL });
    const attr = new WeatherDamageReductionAbAttr({
      weathers: [WeatherType.HAIL, WeatherType.SNOW],
      multiplier: 0.5,
    });
    const result = runReduce({ attr, initialDamage: 200 });
    expect(result.fired).toBe(true);
    expect(result.finalDamage).toBe(100);
  });

  it("does NOT fire when weather isn't in the configured set", () => {
    mockArena({ weatherType: WeatherType.SUNNY });
    const attr = new WeatherDamageReductionAbAttr({
      weathers: [WeatherType.HAIL],
      multiplier: 0.5,
    });
    const result = runReduce({ attr, initialDamage: 100 });
    expect(result.fired).toBe(false);
    expect(result.finalDamage).toBe(100);
  });

  it("respects weather suppression", () => {
    mockArena({ weatherType: WeatherType.HAIL, suppressed: true });
    const attr = new WeatherDamageReductionAbAttr({
      weathers: [WeatherType.HAIL],
      multiplier: 0.5,
    });
    expect(runReduce({ attr }).fired).toBe(false);
  });

  it("exposes its configuration via accessors", () => {
    const attr = new WeatherDamageReductionAbAttr({
      weathers: [WeatherType.SANDSTORM],
      multiplier: 0.75,
    });
    expect(attr.getWeathers()).toEqual([WeatherType.SANDSTORM]);
    expect(attr.getMultiplier()).toBe(0.75);
  });

  it("rejects out-of-range multipliers at construction time", () => {
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [WeatherType.HAIL], multiplier: 0 })).toThrow(
      /multiplier must be in/,
    );
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [WeatherType.HAIL], multiplier: 1.5 })).toThrow(
      /multiplier must be in/,
    );
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [], multiplier: 0.5 })).toThrow(
      /weathers must include at least one/,
    );
  });
});

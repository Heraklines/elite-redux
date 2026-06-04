/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: post-turn-hurt-non-typed cluster.
//
// Covers ER abilities Toxic Spill / Flame Coat / Funeral Pyre that deal chip
// damage to opposing non-safe-type Pokemon each turn.
//
// We use `initGlobalScene` (matching the convention used by `passive-recovery.
// test.ts` in the archetype layer) to inject a stub scene and arena. The
// Magic Guard cancellation path uses the real `applyAbAttrs`; our stub
// opponents return an empty-attrs ability so no cancellation fires — testing
// the cancellation behavior end-to-end would require a real ability stack
// (deferred to harness-level tests). We document the unguarded call here.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queueMessage = vi.fn();
let currentWeather: WeatherType = WeatherType.NONE;

function setCurrentWeather(weather: WeatherType): void {
  currentWeather = weather;
}

beforeEach(() => {
  queueMessage.mockClear();
  currentWeather = WeatherType.NONE;
  initGlobalScene({
    phaseManager: {
      queueMessage: (...args: unknown[]) => queueMessage(...args),
      queueAbilityDisplay: () => {},
    },
    // Arena stub exposes only the live `weatherType` field — that's what
    // the weather-gated branch of `PostTurnHurtNonTypedAbAttr` reads.
    arena: {
      get weatherType() {
        return currentWeather;
      },
    },
  } as unknown as BattleScene);
});

type StubOppOpts = {
  types: PokemonType[];
  maxHp?: number;
  fainted?: boolean;
  switchedOut?: boolean;
};

function makeStubOpponent(opts: StubOppOpts): Pokemon & { damageAndUpdate: ReturnType<typeof vi.fn> } {
  const damageAndUpdate = vi.fn();
  // Stub returns an empty-attrs ability so `applyAbAttrs("BlockNonDirect..")`
  // finds nothing to apply (no cancellation). passive slots also empty.
  // `canApplyAbility` returns false to short-circuit the active/passive
  // dispatch — equivalent to "this opponent has no ability that blocks
  // indirect damage", which matches the common-case behavior under test.
  const emptyAbility = { id: 0, attrs: [] };
  return {
    isOfType: (t: PokemonType) => opts.types.includes(t),
    getMaxHp: () => opts.maxHp ?? 100,
    isFainted: () => opts.fainted ?? false,
    switchOutStatus: opts.switchedOut ?? false,
    damageAndUpdate,
    getAbility: () => emptyAbility,
    getPassiveAbilities: () => [null, null, null],
    canApplyAbility: () => false,
    getNameToRender: () => "Stub",
    // Mark as non-enemy so getPokemonNameWithAffix's i18next path is skipped.
    isEnemy: () => false,
    waveData: { abilitiesApplied: new Set() },
    summonData: { abilitiesApplied: new Set() },
  } as unknown as Pokemon & { damageAndUpdate: ReturnType<typeof vi.fn> };
}

function makeStubSubject(opts: { opponents: Pokemon[] }): Pokemon {
  return {
    getOpponents: () => opts.opponents,
  } as unknown as Pokemon;
}

describe("PostTurnHurtNonTypedAbAttr", () => {
  it("constructs with valid options (Toxic Spill)", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 8,
    });
    expect(attr.getSafeTypes()).toEqual([PokemonType.POISON]);
    expect(attr.getDamageFraction()).toBeCloseTo(1 / 8);
  });

  it("rejects invalid damageFraction (zero, negative, or > 1)", () => {
    expect(() => new PostTurnHurtNonTypedAbAttr({ safeTypes: [], damageFraction: 0 })).toThrow();
    expect(() => new PostTurnHurtNonTypedAbAttr({ safeTypes: [], damageFraction: -0.1 })).toThrow();
    expect(() => new PostTurnHurtNonTypedAbAttr({ safeTypes: [], damageFraction: 1.5 })).toThrow();
  });

  it("canApply returns true when at least one foe is non-safe-typed", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 8,
    });
    const safe = makeStubOpponent({ types: [PokemonType.POISON] });
    const target = makeStubOpponent({ types: [PokemonType.FIRE] });
    const subject = makeStubSubject({ opponents: [safe, target] });
    expect(attr.canApply({ pokemon: subject, simulated: false })).toBe(true);
  });

  it("canApply returns false when every foe is safe-typed", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 8,
    });
    const safe1 = makeStubOpponent({ types: [PokemonType.POISON] });
    const safe2 = makeStubOpponent({ types: [PokemonType.POISON, PokemonType.STEEL] });
    const subject = makeStubSubject({ opponents: [safe1, safe2] });
    expect(attr.canApply({ pokemon: subject, simulated: false })).toBe(false);
  });

  it("apply deals 1/8 max HP to every non-safe foe", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 8,
    });
    const safe = makeStubOpponent({ types: [PokemonType.POISON], maxHp: 200 });
    const target = makeStubOpponent({ types: [PokemonType.FIRE], maxHp: 200 });
    const subject = makeStubSubject({ opponents: [safe, target] });
    attr.apply({ pokemon: subject, simulated: false });
    expect(safe.damageAndUpdate).not.toHaveBeenCalled();
    // 1/8 of 200 = 25, toDmgValue keeps integer.
    expect(target.damageAndUpdate).toHaveBeenCalledWith(25, expect.objectContaining({}));
  });

  it("apply skips fainted and switched-out foes", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 4,
    });
    const fainted = makeStubOpponent({ types: [PokemonType.FIRE], fainted: true });
    const switched = makeStubOpponent({ types: [PokemonType.GRASS], switchedOut: true });
    const live = makeStubOpponent({ types: [PokemonType.WATER], maxHp: 100 });
    const subject = makeStubSubject({ opponents: [fainted, switched, live] });
    attr.apply({ pokemon: subject, simulated: false });
    expect(fainted.damageAndUpdate).not.toHaveBeenCalled();
    expect(switched.damageAndUpdate).not.toHaveBeenCalled();
    expect(live.damageAndUpdate).toHaveBeenCalledWith(25, expect.objectContaining({}));
  });

  it("Funeral Pyre style: skips Ghost OR Dark foes (multi-type immunity)", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.GHOST, PokemonType.DARK],
      damageFraction: 1 / 4,
    });
    const ghost = makeStubOpponent({ types: [PokemonType.GHOST] });
    const dark = makeStubOpponent({ types: [PokemonType.DARK] });
    const dual = makeStubOpponent({ types: [PokemonType.NORMAL, PokemonType.GHOST] });
    const target = makeStubOpponent({ types: [PokemonType.FIGHTING] });
    const subject = makeStubSubject({ opponents: [ghost, dark, dual, target] });
    attr.apply({ pokemon: subject, simulated: false });
    expect(ghost.damageAndUpdate).not.toHaveBeenCalled();
    expect(dark.damageAndUpdate).not.toHaveBeenCalled();
    expect(dual.damageAndUpdate).not.toHaveBeenCalled();
    expect(target.damageAndUpdate).toHaveBeenCalled();
  });

  it("simulated runs skip the side effect", () => {
    const attr = new PostTurnHurtNonTypedAbAttr({
      safeTypes: [PokemonType.POISON],
      damageFraction: 1 / 8,
    });
    const target = makeStubOpponent({ types: [PokemonType.FIRE] });
    const subject = makeStubSubject({ opponents: [target] });
    attr.apply({ pokemon: subject, simulated: true });
    expect(target.damageAndUpdate).not.toHaveBeenCalled();
  });

  describe("requiredWeathers gate (Christmas Nightmare)", () => {
    it("getRequiredWeathers returns null when omitted", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [PokemonType.POISON],
        damageFraction: 1 / 8,
      });
      expect(attr.getRequiredWeathers()).toBeNull();
    });

    it("getRequiredWeathers returns the configured list when set", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [],
        damageFraction: 1 / 8,
        requiredWeathers: [WeatherType.HAIL, WeatherType.SNOW],
      });
      expect(attr.getRequiredWeathers()).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
    });

    it("treats empty requiredWeathers list as omitted (null)", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [PokemonType.FIRE],
        damageFraction: 1 / 8,
        requiredWeathers: [],
      });
      expect(attr.getRequiredWeathers()).toBeNull();
    });

    it("canApply returns false when weather gate not satisfied", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [],
        damageFraction: 1 / 8,
        requiredWeathers: [WeatherType.HAIL, WeatherType.SNOW],
      });
      setCurrentWeather(WeatherType.RAIN);
      const target = makeStubOpponent({ types: [PokemonType.FIRE] });
      const subject = makeStubSubject({ opponents: [target] });
      expect(attr.canApply({ pokemon: subject, simulated: false })).toBe(false);
    });

    it("canApply returns true when one of the required weathers is active", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [],
        damageFraction: 1 / 8,
        requiredWeathers: [WeatherType.HAIL, WeatherType.SNOW],
      });
      setCurrentWeather(WeatherType.SNOW);
      const target = makeStubOpponent({ types: [PokemonType.FIRE] });
      const subject = makeStubSubject({ opponents: [target] });
      expect(attr.canApply({ pokemon: subject, simulated: false })).toBe(true);
    });

    it("weather-agnostic instances (no gate) fire under any weather, including NONE", () => {
      const attr = new PostTurnHurtNonTypedAbAttr({
        safeTypes: [PokemonType.FIRE],
        damageFraction: 1 / 8,
      });
      setCurrentWeather(WeatherType.NONE);
      const target = makeStubOpponent({ types: [PokemonType.WATER] });
      const subject = makeStubSubject({ opponents: [target] });
      expect(attr.canApply({ pokemon: subject, simulated: false })).toBe(true);
    });
  });
});

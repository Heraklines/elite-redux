import { ER_REACTIVE_CONFIG, resolveReactiveProc } from "#data/elite-redux/er-reactive-items";
import { HitResult } from "#enums/hit-result";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

/**
 * Reactive held items (Cell Battery / Absorb Bulb / Snowball / Luminous Moss /
 * Weakness Policy): proc when the HOLDER is hit by the right move, raise a stat
 * once, then consume. These tests cover the pure trigger rules.
 */
describe("er-reactive-items (resolveReactiveProc)", () => {
  it("Cell Battery procs on an Electric hit -> +1 Atk", () => {
    expect(resolveReactiveProc("cellBattery", PokemonType.ELECTRIC, HitResult.EFFECTIVE, true)).toEqual([
      [Stat.ATK, 1],
    ]);
  });

  it("Cell Battery does NOT proc on a non-Electric hit", () => {
    expect(resolveReactiveProc("cellBattery", PokemonType.WATER, HitResult.EFFECTIVE, true)).toBeNull();
  });

  it("Absorb Bulb (Water -> +SpA) and Luminous Moss (Water -> +SpD) both react to Water", () => {
    expect(resolveReactiveProc("absorbBulb", PokemonType.WATER, HitResult.EFFECTIVE, true)).toEqual([[Stat.SPATK, 1]]);
    expect(resolveReactiveProc("luminousMoss", PokemonType.WATER, HitResult.EFFECTIVE, true)).toEqual([
      [Stat.SPDEF, 1],
    ]);
  });

  it("Snowball procs on an Ice hit -> +1 Atk", () => {
    expect(resolveReactiveProc("snowball", PokemonType.ICE, HitResult.EFFECTIVE, true)).toEqual([[Stat.ATK, 1]]);
  });

  it("Weakness Policy procs on a SUPER-EFFECTIVE hit of any type -> +2 Atk & +2 SpA", () => {
    expect(resolveReactiveProc("weaknessPolicy", PokemonType.GRASS, HitResult.SUPER_EFFECTIVE, true)).toEqual([
      [Stat.ATK, 2],
      [Stat.SPATK, 2],
    ]);
  });

  it("Weakness Policy does NOT proc on a neutral hit", () => {
    expect(resolveReactiveProc("weaknessPolicy", PokemonType.GRASS, HitResult.EFFECTIVE, true)).toBeNull();
  });

  it("nothing procs when the hit dealt no damage (status move / immune)", () => {
    expect(resolveReactiveProc("cellBattery", PokemonType.ELECTRIC, HitResult.EFFECTIVE, false)).toBeNull();
    expect(resolveReactiveProc("weaknessPolicy", PokemonType.GRASS, HitResult.SUPER_EFFECTIVE, false)).toBeNull();
  });

  it("every config entry boosts at least one stat", () => {
    for (const cfg of Object.values(ER_REACTIVE_CONFIG)) {
      expect(cfg.boosts.length).toBeGreaterThan(0);
    }
  });
});

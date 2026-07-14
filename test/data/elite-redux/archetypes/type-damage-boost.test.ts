/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `type-damage-boost` archetype.
//
// We exercise the archetype primitive directly (constructing a fresh
// `TypeDamageBoostAbAttr`, building duck-typed pokemon/move/power-holder
// objects, calling `canApply` and `apply` against them) because the C0
// battle harness's trigger set doesn't yet include a "during damage
// calculation" scenario — the closest existing harness trigger is
// `PostSummonAbAttr`, which is the wrong surface for power-boost archetypes.
//
// Direct unit testing here is the right tool: the archetype is a pure
// transformation of `power.value`, so we don't need the dispatcher's
// slot-routing / suppression logic to verify the math.
// =============================================================================

import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

/**
 * Build a duck-typed `pokemon` stub whose `getMoveType(move)` returns the
 * move's literal `_type` (no Aerilate-style overrides), and whose
 * `getHpRatio(true)` returns the configured value.
 */
function makeStubPokemon(opts: { hpRatio?: number }): Pokemon {
  const hpRatio = opts.hpRatio ?? 1;
  return {
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
    getHpRatio: (_precise = false) => hpRatio,
  } as unknown as Pokemon;
}

/**
 * Build a duck-typed `move` stub with the given type. We populate `_type`
 * (the private field that `getMoveType` reads via the stub above) rather
 * than going through the Move constructor — the archetype only cares about
 * the resolved type, and constructing real Move instances drags in i18n.
 */
function makeStubMove(type: PokemonType): Move {
  return { _type: type } as unknown as Move;
}

/**
 * Run `canApply` followed by `apply` (if canApply passed) and return the
 * resulting `power.value`. This mirrors what `applyAbAttrs` does inside the
 * dispatcher, so the assertions match real-battle semantics.
 */
function runBoost(opts: { attr: TypeDamageBoostAbAttr; pokemon: Pokemon; move: Move; initialPower: number }): {
  fired: boolean;
  finalPower: number;
} {
  const power = new NumberHolder(opts.initialPower);
  const params = {
    pokemon: opts.pokemon,
    opponent: opts.pokemon, // defender — irrelevant to type-match gate
    move: opts.move,
    power,
    simulated: true,
  } as unknown as Parameters<TypeDamageBoostAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPower: power.value };
}

describe("TypeDamageBoostAbAttr archetype (C1)", () => {
  it("applies the multiplier when the move type matches", () => {
    const attr = new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.5 });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 1 }),
      move: makeStubMove(PokemonType.FIRE),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBe(150);
  });

  it("does NOT fire when the move type differs", () => {
    const attr = new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.5 });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 1 }),
      move: makeStubMove(PokemonType.WATER),
      initialPower: 100,
    });
    expect(result.fired).toBe(false);
    expect(result.finalPower).toBe(100);
  });

  it("uses lowHpMultiplier when subject HP is strictly below the threshold", () => {
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.GRASS,
      multiplier: 1.2,
      lowHpMultiplier: 1.5,
    });
    // 0.3 < 1/3 (~0.333) → low-HP branch
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 0.3 }),
      move: makeStubMove(PokemonType.GRASS),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBe(150);
  });

  it("uses the low-HP multiplier when subject HP is exactly at the threshold (boundary-inclusive)", () => {
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.GRASS,
      multiplier: 1.2,
      lowHpMultiplier: 1.5,
    });
    // ratio === threshold → ER "1/3 HP or lower" is inclusive → low-HP branch
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 1 / 3 }),
      move: makeStubMove(PokemonType.GRASS),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBeCloseTo(150, 5);
  });

  it("respects a custom lowHpThreshold", () => {
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.ELECTRIC,
      multiplier: 1.0,
      lowHpMultiplier: 2.0,
      lowHpThreshold: 0.5,
    });
    // ratio 0.49 < 0.5 → low-HP branch
    const low = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 0.49 }),
      move: makeStubMove(PokemonType.ELECTRIC),
      initialPower: 100,
    });
    expect(low.finalPower).toBe(200);
    // ratio 0.5 === threshold → boundary-inclusive → low-HP branch (2.0×)
    const high = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 0.5 }),
      move: makeStubMove(PokemonType.ELECTRIC),
      initialPower: 100,
    });
    expect(high.finalPower).toBe(200);
  });

  it("never invokes the low-HP branch when lowHpMultiplier is not configured", () => {
    const attr = new TypeDamageBoostAbAttr({ type: PokemonType.WATER, multiplier: 1.25 });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 0.01 }), // very low HP
      move: makeStubMove(PokemonType.WATER),
      initialPower: 100,
    });
    expect(result.finalPower).toBe(125);
    expect(attr.getLowHpMultiplier()).toBeNull();
  });

  it("exposes its configuration via accessors", () => {
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.PSYCHIC,
      multiplier: 1.3,
      lowHpMultiplier: 1.8,
      lowHpThreshold: 0.25,
    });
    expect(attr.getBoostType()).toBe(PokemonType.PSYCHIC);
    expect(attr.getHighHpMultiplier()).toBe(1.3);
    expect(attr.getLowHpMultiplier()).toBe(1.8);
    expect(attr.getLowHpThreshold()).toBe(0.25);
  });

  it("resolveMultiplier picks the correct branch for arbitrary hp ratios", () => {
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.DARK,
      multiplier: 1.1,
      lowHpMultiplier: 1.7,
    });
    expect(attr.resolveMultiplier(1.0)).toBe(1.1);
    expect(attr.resolveMultiplier(0.5)).toBe(1.1);
    expect(attr.resolveMultiplier(0.33)).toBe(1.7); // below 1/3
    expect(attr.resolveMultiplier(0)).toBe(1.7);
  });

  it("rejects non-positive multipliers at construction time", () => {
    expect(() => new TypeDamageBoostAbAttr({ type: PokemonType.NORMAL, multiplier: 0 })).toThrow(
      /multiplier must be > 0/,
    );
    expect(() => new TypeDamageBoostAbAttr({ type: PokemonType.NORMAL, multiplier: -1 })).toThrow(
      /multiplier must be > 0/,
    );
    expect(
      () =>
        new TypeDamageBoostAbAttr({
          type: PokemonType.NORMAL,
          multiplier: 1.5,
          lowHpMultiplier: 0,
        }),
    ).toThrow(/lowHpMultiplier must be > 0/);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 9 of the bespoke ability grind: tests for the
// `stab-add` archetype primitive.
//
// We exercise the archetype directly (constructing a fresh `StabAddAbAttr`,
// building duck-typed pokemon/move/power-holder objects, calling `canApply`
// and `apply`) — same pattern used by `type-damage-boost.test.ts`. The
// archetype is a pure transformation of `power.value`, so we don't need the
// dispatcher or battle harness to verify the math.
// =============================================================================

import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

/**
 * Build a duck-typed `pokemon` stub whose `getMoveType(move)` returns the
 * move's literal `_type` (no Aerilate-style overrides), and whose
 * `getTypes(false, false)` returns the configured source types.
 */
function makeStubPokemon(opts: { sourceTypes: PokemonType[] }): Pokemon {
  return {
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
    getTypes: (_includeTera = false, _forDefend = false) => opts.sourceTypes,
  } as unknown as Pokemon;
}

/**
 * Build a duck-typed `move` stub with the given type.
 */
function makeStubMove(type: PokemonType): Move {
  return { _type: type } as unknown as Move;
}

/**
 * Run `canApply` followed by `apply` (if canApply passed) and return the
 * resulting `power.value`.
 */
function runBoost(opts: { attr: StabAddAbAttr; pokemon: Pokemon; move: Move; initialPower: number }): {
  fired: boolean;
  finalPower: number;
} {
  const power = new NumberHolder(opts.initialPower);
  const params = {
    pokemon: opts.pokemon,
    opponent: opts.pokemon,
    move: opts.move,
    power,
    simulated: true,
  } as unknown as Parameters<StabAddAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPower: power.value };
}

describe("StabAddAbAttr archetype (R9 stab-add)", () => {
  describe("single-type stab-add (Aurora Borealis / Amphibious shape)", () => {
    it("applies the 1.5x boost when the move type matches targetType and is off-type", () => {
      // Aurora Borealis on a non-Ice Pokemon using Ice Beam → +50% power.
      const attr = new StabAddAbAttr({ targetType: PokemonType.ICE });
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.WATER] }),
        move: makeStubMove(PokemonType.ICE),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(150);
    });

    it("does NOT fire on a move type different from targetType", () => {
      // Aurora Borealis user firing a Water move — Water ≠ Ice, no boost.
      const attr = new StabAddAbAttr({ targetType: PokemonType.ICE });
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.WATER] }),
        move: makeStubMove(PokemonType.WATER),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
      expect(result.finalPower).toBe(100);
    });

    it("does NOT fire on a move type that already matches a user type (avoids double-stab)", () => {
      // Aurora Borealis on an Ice-type user using Ice Beam — vanilla STAB
      // already gives +0.5; we don't want to add another +0.5.
      const attr = new StabAddAbAttr({ targetType: PokemonType.ICE });
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.ICE, PokemonType.FAIRY] }),
        move: makeStubMove(PokemonType.ICE),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
      expect(result.finalPower).toBe(100);
    });
  });

  describe("all-types stab-add (Mystic Power / Arcane Force shape)", () => {
    it("applies the 1.5x boost on any off-type move when targetType is omitted", () => {
      const attr = new StabAddAbAttr();
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.FIRE] }),
        move: makeStubMove(PokemonType.ELECTRIC),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(150);
    });

    it("does NOT fire on a move type that is already a source type (avoids double-stab)", () => {
      // Mystic Power user with type Fire firing a Fire move — vanilla STAB
      // already gives +0.5.
      const attr = new StabAddAbAttr();
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.FIRE] }),
        move: makeStubMove(PokemonType.FIRE),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
      expect(result.finalPower).toBe(100);
    });

    it("fires for every off-type when no targetType is configured", () => {
      const attr = new StabAddAbAttr();
      const pokemon = makeStubPokemon({ sourceTypes: [PokemonType.NORMAL] });
      // Sample a handful of off-types.
      for (const t of [PokemonType.FIRE, PokemonType.WATER, PokemonType.PSYCHIC, PokemonType.DARK]) {
        const result = runBoost({ attr, pokemon, move: makeStubMove(t), initialPower: 100 });
        expect(result.fired).toBe(true);
        expect(result.finalPower).toBe(150);
      }
    });
  });

  describe("custom multiplier", () => {
    it("respects a non-default multiplier", () => {
      const attr = new StabAddAbAttr({ targetType: PokemonType.FAIRY, multiplier: 1.3 });
      const result = runBoost({
        attr,
        pokemon: makeStubPokemon({ sourceTypes: [PokemonType.STEEL] }),
        move: makeStubMove(PokemonType.FAIRY),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(130);
    });

    it("rejects non-positive multipliers at construction time", () => {
      expect(() => new StabAddAbAttr({ targetType: PokemonType.NORMAL, multiplier: 0 })).toThrow(
        /multiplier must be > 0/,
      );
      expect(() => new StabAddAbAttr({ multiplier: -1 })).toThrow(/multiplier must be > 0/);
    });
  });

  describe("accessors", () => {
    it("exposes targetType and multiplier", () => {
      const attr = new StabAddAbAttr({ targetType: PokemonType.DRAGON, multiplier: 1.4 });
      expect(attr.getTargetType()).toBe(PokemonType.DRAGON);
      expect(attr.getMultiplier()).toBe(1.4);
    });

    it("returns null targetType when omitted (all-types shape)", () => {
      const attr = new StabAddAbAttr();
      expect(attr.getTargetType()).toBeNull();
      expect(attr.getMultiplier()).toBe(1.5);
    });
  });
});

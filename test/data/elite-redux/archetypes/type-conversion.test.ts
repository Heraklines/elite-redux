/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: tests for the `type-conversion` archetype.
//
// We exercise the source-filter predicate (type-keyed, flag-keyed, flag+
// requireType) plus construction validation. The actual type rewrite logic
// lives in the parent (`MoveTypeChangeAbAttr.apply`) and tests for that
// belong upstream — here we only verify our predicate fires correctly.
// =============================================================================

import {
  TypeConversionAbAttr,
  TypeConversionPowerBoostAbAttr,
  type TypeConversionSource,
} from "#data/elite-redux/archetypes/type-conversion";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeStubPokemon(): Pokemon {
  return {
    id: 1,
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { type?: PokemonType; flags?: MoveFlags }): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    _type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

function runConversion(opts: { attr: TypeConversionAbAttr; pokemon: Pokemon; move: Move; initialType?: PokemonType }) {
  const moveType = new NumberHolder(opts.initialType ?? PokemonType.NORMAL);
  const params = {
    pokemon: opts.pokemon,
    opponent: opts.pokemon,
    move: opts.move,
    moveType,
    simulated: true,
  } as unknown as Parameters<TypeConversionAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalType: moveType.value };
}

describe("TypeConversionAbAttr archetype (C1d)", () => {
  describe("type-keyed source filter (Aerilate-style)", () => {
    it("Immolate-style: Normal moves become Fire", () => {
      const attr = new TypeConversionAbAttr({
        source: { kind: "type", type: PokemonType.NORMAL },
        newType: PokemonType.FIRE,
      });
      const result = runConversion({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.NORMAL }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalType).toBe(PokemonType.FIRE);
    });

    it("does NOT fire for moves of a different source type", () => {
      const attr = new TypeConversionAbAttr({
        source: { kind: "type", type: PokemonType.NORMAL },
        newType: PokemonType.FIRE,
      });
      const result = runConversion({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.WATER }),
      });
      expect(result.fired).toBe(false);
    });

    it("Crystallize-style: Rock moves become Ice", () => {
      const attr = new TypeConversionAbAttr({
        source: { kind: "type", type: PokemonType.ROCK },
        newType: PokemonType.ICE,
      });
      const result = runConversion({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.ROCK }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalType).toBe(PokemonType.ICE);
    });
  });

  describe("flag-keyed source filter", () => {
    it("Reverberate-style: all Sound moves become a specific type (no requireType)", () => {
      const attr = new TypeConversionAbAttr({
        source: { kind: "flag", flag: MoveFlags.SOUND_BASED },
        newType: PokemonType.GROUND,
      });
      const result = runConversion({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.WATER, flags: MoveFlags.SOUND_BASED }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalType).toBe(PokemonType.GROUND);
    });

    it("does NOT fire when the move lacks the configured flag", () => {
      const attr = new TypeConversionAbAttr({
        source: { kind: "flag", flag: MoveFlags.SOUND_BASED },
        newType: PokemonType.GROUND,
      });
      const result = runConversion({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.NORMAL, flags: MoveFlags.NONE }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("flag + requireType source filter (Sand-Song-style)", () => {
    it("Sand-Song-style: Normal Sound moves become Ground; non-Normal Sound moves unchanged", () => {
      const attr = new TypeConversionAbAttr({
        source: {
          kind: "flag",
          flag: MoveFlags.SOUND_BASED,
          requireType: PokemonType.NORMAL,
        },
        newType: PokemonType.GROUND,
      });
      // Normal + Sound → fires
      expect(
        runConversion({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.NORMAL, flags: MoveFlags.SOUND_BASED }),
        }).fired,
      ).toBe(true);
      // Water + Sound → no fire (requireType mismatch)
      expect(
        runConversion({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.WATER, flags: MoveFlags.SOUND_BASED }),
        }).fired,
      ).toBe(false);
      // Normal + non-Sound → no fire (flag mismatch)
      expect(
        runConversion({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.NORMAL, flags: MoveFlags.NONE }),
        }).fired,
      ).toBe(false);
    });
  });

  describe("matchesSource static helper", () => {
    it("evaluates a type-keyed filter directly", () => {
      const source: TypeConversionSource = { kind: "type", type: PokemonType.GRASS };
      const pokemon = makeStubPokemon();
      expect(TypeConversionAbAttr.matchesSource(source, pokemon, makeStubMove({ type: PokemonType.GRASS }))).toBe(true);
      expect(TypeConversionAbAttr.matchesSource(source, pokemon, makeStubMove({ type: PokemonType.WATER }))).toBe(
        false,
      );
    });

    it("evaluates a flag+requireType filter directly", () => {
      const source: TypeConversionSource = {
        kind: "flag",
        flag: MoveFlags.PUNCHING_MOVE,
        requireType: PokemonType.FIGHTING,
      };
      const pokemon = makeStubPokemon();
      expect(
        TypeConversionAbAttr.matchesSource(
          source,
          pokemon,
          makeStubMove({ type: PokemonType.FIGHTING, flags: MoveFlags.PUNCHING_MOVE }),
        ),
      ).toBe(true);
      expect(
        TypeConversionAbAttr.matchesSource(
          source,
          pokemon,
          makeStubMove({ type: PokemonType.NORMAL, flags: MoveFlags.PUNCHING_MOVE }),
        ),
      ).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the source filter and new type", () => {
      const source: TypeConversionSource = { kind: "type", type: PokemonType.NORMAL };
      const attr = new TypeConversionAbAttr({ source, newType: PokemonType.FIRE });
      expect(attr.getSource()).toBe(source);
      expect(attr.getNewType()).toBe(PokemonType.FIRE);
    });
  });

  describe("validation", () => {
    it("rejects newType = UNKNOWN", () => {
      expect(
        () =>
          new TypeConversionAbAttr({
            source: { kind: "type", type: PokemonType.NORMAL },
            newType: PokemonType.UNKNOWN,
          }),
      ).toThrow(/newType cannot be/);
    });

    it("rejects source.type = UNKNOWN", () => {
      expect(
        () =>
          new TypeConversionAbAttr({
            source: { kind: "type", type: PokemonType.UNKNOWN },
            newType: PokemonType.FIRE,
          }),
      ).toThrow(/source\.type cannot be/);
    });

    it("rejects source.flag = NONE", () => {
      expect(
        () =>
          new TypeConversionAbAttr({
            source: { kind: "flag", flag: MoveFlags.NONE },
            newType: PokemonType.FIRE,
          }),
      ).toThrow(/non-NONE MoveFlags bit/);
    });
  });
});

describe("TypeConversionPowerBoostAbAttr archetype (C1d)", () => {
  describe("filter matching", () => {
    it("returns matchesSource true for matching source", () => {
      const attr = new TypeConversionPowerBoostAbAttr({
        source: { kind: "type", type: PokemonType.NORMAL },
        multiplier: 1.1,
      });
      const pokemon = makeStubPokemon();
      expect(
        TypeConversionAbAttr.matchesSource(attr.getSource(), pokemon, makeStubMove({ type: PokemonType.NORMAL })),
      ).toBe(true);
    });

    it("returns matchesSource false for non-matching source", () => {
      const attr = new TypeConversionPowerBoostAbAttr({
        source: { kind: "type", type: PokemonType.NORMAL },
        multiplier: 1.1,
      });
      const pokemon = makeStubPokemon();
      expect(
        TypeConversionAbAttr.matchesSource(attr.getSource(), pokemon, makeStubMove({ type: PokemonType.WATER })),
      ).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured source and multiplier", () => {
      const attr = new TypeConversionPowerBoostAbAttr({
        source: { kind: "flag", flag: MoveFlags.SOUND_BASED },
        multiplier: 1.2,
      });
      expect(attr.getSource()).toEqual({ kind: "flag", flag: MoveFlags.SOUND_BASED });
      expect(attr.getMultiplier()).toBe(1.2);
    });
  });

  describe("validation", () => {
    it("rejects multiplier = 0", () => {
      expect(
        () =>
          new TypeConversionPowerBoostAbAttr({
            source: { kind: "type", type: PokemonType.NORMAL },
            multiplier: 0,
          }),
      ).toThrow(/must be > 0/);
    });

    it("rejects source.flag = NONE", () => {
      expect(
        () =>
          new TypeConversionPowerBoostAbAttr({
            source: { kind: "flag", flag: MoveFlags.NONE },
            multiplier: 1.1,
          }),
      ).toThrow(/non-NONE MoveFlags bit/);
    });
  });
});

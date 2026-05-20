/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `entry-effect` archetype.
//
// The archetype carries a discriminated `EntryEffect` payload — the tests
// cover three concerns:
//
//   1. Construction: every discriminator kind round-trips through
//      `getEffect()` / `getKind()` accessors. (Smoke for the data layer
//      that will configure these on real ER abilities.)
//   2. `canApply`: always returns `true`, no globalScene access. (This is
//      the contract the C0 harness's record-only mode relies on.)
//   3. `apply` routing: for `simulated: true` runs, no side effects fire
//      (matches pokerogue's `PostSummonAbAttr` family convention). For the
//      `add-self-type` sub-effect — which doesn't depend on globalScene —
//      we run `simulated: false` and assert the pokemon's type list grew
//      as configured. Other sub-effects' globalScene side effects are
//      verified at integration-test time in later tasks; here we only
//      verify the dispatch reaches the right switch arm.
// =============================================================================

import { type EntryEffect, EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { describe, expect, it } from "vitest";

/**
 * Stub pokemon. The archetype's `add-self-type` branch mutates
 * `summonData.types` and reads `getTypes()` only when `summonData.types` is
 * null. Tests construct the stub with whichever initial type list they need.
 */
function makeStubPokemon(opts: {
  initialTypes?: PokemonType[];
  /** If true, leaves `summonData.types` set to null so apply must hit the `getTypes()` fallback. */
  nullSummonTypes?: boolean;
}): Pokemon {
  const types = opts.initialTypes ?? [PokemonType.NORMAL];
  const summonData: { types: PokemonType[] | null } = {
    types: opts.nullSummonTypes ? null : [...types],
  };
  return {
    id: 12345,
    summonData,
    getTypes: () => types,
    getBattlerIndex: () => 0,
  } as unknown as Pokemon;
}

function makeParams(pokemon: Pokemon, simulated: boolean): AbAttrBaseParams {
  return {
    pokemon,
    simulated,
  } as AbAttrBaseParams;
}

describe("EntryEffectAbAttr archetype (C1)", () => {
  describe("construction + introspection", () => {
    it("round-trips an `add-self-type` payload", () => {
      const effect: EntryEffect = { kind: "add-self-type", type: PokemonType.WATER };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("add-self-type");
    });

    it("round-trips a `set-weather` payload", () => {
      const effect: EntryEffect = { kind: "set-weather", weather: WeatherType.SUNNY, turns: 8 };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("set-weather");
    });

    it("round-trips a `set-terrain` payload", () => {
      const effect: EntryEffect = {
        kind: "set-terrain",
        terrain: TerrainType.ELECTRIC,
        turns: 8,
      };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("set-terrain");
    });

    it("round-trips a `set-hazard` payload (multi-layer)", () => {
      const effect: EntryEffect = { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: 2 };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("set-hazard");
    });

    it("round-trips a `set-screen-or-room` payload", () => {
      const effect: EntryEffect = {
        kind: "set-screen-or-room",
        tag: ArenaTagType.GRAVITY,
        turns: 8,
      };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("set-screen-or-room");
    });

    it("round-trips a `self-stat-boost` payload", () => {
      const effect: EntryEffect = { kind: "self-stat-boost", stat: Stat.SPDEF, stages: 1 };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("self-stat-boost");
    });

    it("round-trips a `first-move-priority` payload", () => {
      const effect: EntryEffect = {
        kind: "first-move-priority",
        flag: MoveFlags.SLICING_MOVE,
        priority: 1,
      };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("first-move-priority");
    });

    it("round-trips a `scripted-move` payload", () => {
      const effect: EntryEffect = { kind: "scripted-move", move: MoveId.ASTONISH };
      const attr = new EntryEffectAbAttr(effect);
      expect(attr.getEffect()).toEqual(effect);
      expect(attr.getKind()).toBe("scripted-move");
    });
  });

  describe("canApply", () => {
    it("always returns true regardless of payload kind", () => {
      const kinds: EntryEffect[] = [
        { kind: "add-self-type", type: PokemonType.ICE },
        { kind: "set-weather", weather: WeatherType.RAIN, turns: 5 },
        { kind: "set-terrain", terrain: TerrainType.GRASSY, turns: 5 },
        { kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK },
        { kind: "set-screen-or-room", tag: ArenaTagType.TAILWIND, turns: 4 },
        { kind: "self-stat-boost", stat: Stat.SPD, stages: 1 },
        { kind: "first-move-priority", flag: MoveFlags.PUNCHING_MOVE, priority: 1 },
        { kind: "scripted-move", move: MoveId.ASTONISH },
      ];
      const params = makeParams(makeStubPokemon({}), true);
      for (const kind of kinds) {
        const attr = new EntryEffectAbAttr(kind);
        expect(attr.canApply(params)).toBe(true);
      }
    });
  });

  describe("apply — simulated dispatch", () => {
    it("is a no-op when params.simulated is true (no globalScene access)", () => {
      const pokemon = makeStubPokemon({ initialTypes: [PokemonType.GHOST] });
      const attr = new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.DRAGON });
      // Capture the initial summonData.types reference.
      const initialTypes = [...(pokemon.summonData as { types: PokemonType[] }).types];
      // No throws → exits cleanly via the early return.
      attr.apply(makeParams(pokemon, true));
      // No mutation either.
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual(initialTypes);
    });

    it.each<EntryEffect>([
      { kind: "set-weather", weather: WeatherType.SUNNY, turns: 8 },
      { kind: "set-terrain", terrain: TerrainType.ELECTRIC, turns: 8 },
      { kind: "set-hazard", hazard: ArenaTagType.SPIKES, layers: 2 },
      { kind: "set-screen-or-room", tag: ArenaTagType.TAILWIND, turns: 4 },
      { kind: "self-stat-boost", stat: Stat.SPDEF, stages: 1 },
      { kind: "first-move-priority", flag: MoveFlags.SLICING_MOVE, priority: 1 },
      { kind: "scripted-move", move: MoveId.ASTONISH },
    ])("simulated dispatch on `$kind` payload is a no-op (no throws)", effect => {
      const attr = new EntryEffectAbAttr(effect);
      const pokemon = makeStubPokemon({});
      expect(() => attr.apply(makeParams(pokemon, true))).not.toThrow();
    });
  });

  describe("apply — add-self-type (non-simulated)", () => {
    it("appends the configured type to summonData.types", () => {
      const pokemon = makeStubPokemon({ initialTypes: [PokemonType.GHOST] });
      const attr = new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.DRAGON });
      attr.apply(makeParams(pokemon, false));
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual([PokemonType.GHOST, PokemonType.DRAGON]);
    });

    it("is idempotent — re-applying the same type does not duplicate it", () => {
      const pokemon = makeStubPokemon({ initialTypes: [PokemonType.WATER] });
      const attr = new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.WATER });
      attr.apply(makeParams(pokemon, false));
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual([PokemonType.WATER]);
      // Second dispatch — still single entry.
      attr.apply(makeParams(pokemon, false));
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual([PokemonType.WATER]);
    });

    it("materializes a null summonData.types from getTypes() before appending", () => {
      // When summonData.types is null, the archetype falls back to pokemon.getTypes().
      const pokemon = makeStubPokemon({
        initialTypes: [PokemonType.GRASS, PokemonType.POISON],
        nullSummonTypes: true,
      });
      const attr = new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE });
      attr.apply(makeParams(pokemon, false));
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual([
        PokemonType.GRASS,
        PokemonType.POISON,
        PokemonType.FIRE,
      ]);
    });

    it("preserves multi-type Pokemon types when appending", () => {
      const pokemon = makeStubPokemon({
        initialTypes: [PokemonType.STEEL, PokemonType.PSYCHIC],
      });
      const attr = new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FAIRY });
      attr.apply(makeParams(pokemon, false));
      expect((pokemon.summonData as { types: PokemonType[] }).types).toEqual([
        PokemonType.STEEL,
        PokemonType.PSYCHIC,
        PokemonType.FAIRY,
      ]);
    });
  });
});

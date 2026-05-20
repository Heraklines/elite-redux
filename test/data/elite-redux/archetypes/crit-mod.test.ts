/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: tests for the `crit-mod` archetype.
//
// The archetype carries three sibling subclasses:
//   - `CritImmunityAbAttr`         — wraps BlockCritAbAttr (no payload).
//   - `CritStageBonusAbAttr`       — wraps BonusCritAbAttr with filter + amount.
//   - `CritDamageMultiplierAbAttr` — wraps MultCritAbAttr with typed options.
//
// Direct unit testing against duck-typed Pokemon/Move stubs and NumberHolder /
// BooleanHolder; no full battle harness required.
// =============================================================================

import {
  CritDamageMultiplierAbAttr,
  CritImmunityAbAttr,
  type CritModFilter,
  CritStageBonusAbAttr,
} from "#data/elite-redux/archetypes/crit-mod";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { BooleanHolder, NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeStubPokemon(): Pokemon {
  return {
    id: 1,
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { type?: PokemonType; flags?: MoveFlags } = {}): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    _type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

function runCritStage(opts: { attr: CritStageBonusAbAttr; pokemon: Pokemon; move: Move; initialStage?: number }): {
  fired: boolean;
  finalStage: number;
} {
  const critStage = new NumberHolder(opts.initialStage ?? 0);
  const params = {
    pokemon: opts.pokemon,
    move: opts.move,
    critStage,
    simulated: true,
  } as unknown as Parameters<CritStageBonusAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalStage: critStage.value };
}

describe("CritImmunityAbAttr archetype (C1e)", () => {
  it("sets blockCrit holder to true on apply", () => {
    const attr = new CritImmunityAbAttr();
    const blockCrit = new BooleanHolder(false);
    const params = {
      pokemon: makeStubPokemon(),
      blockCrit,
      simulated: true,
    } as unknown as Parameters<CritImmunityAbAttr["apply"]>[0];
    attr.apply(params);
    expect(blockCrit.value).toBe(true);
  });

  it("canApply returns true unconditionally (inherited default)", () => {
    const attr = new CritImmunityAbAttr();
    const blockCrit = new BooleanHolder(false);
    const params = {
      pokemon: makeStubPokemon(),
      blockCrit,
      simulated: true,
    } as unknown as Parameters<CritImmunityAbAttr["canApply"]>[0];
    expect(attr.canApply(params)).toBe(true);
  });
});

describe("CritStageBonusAbAttr archetype (C1e)", () => {
  describe("basic apply behavior", () => {
    it("adds +1 to the crit-stage holder (Super-Luck-style)", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1 });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove(),
      });
      expect(result.fired).toBe(true);
      expect(result.finalStage).toBe(1);
    });

    it("adds +2 when bonus=2", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 2 });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove(),
        initialStage: 1,
      });
      expect(result.finalStage).toBe(3);
    });
  });

  describe("filter — type-keyed", () => {
    it("fires on a matching type", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1, filter: { type: PokemonType.FIRE } });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.FIRE }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalStage).toBe(1);
    });

    it("does NOT fire on a different type", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1, filter: { type: PokemonType.FIRE } });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.GRASS }),
      });
      expect(result.fired).toBe(false);
      expect(result.finalStage).toBe(0);
    });
  });

  describe("filter — flag-keyed", () => {
    it("fires on a matching flag (slashing-move-style)", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.SLICING_MOVE } });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.SLICING_MOVE }),
      });
      expect(result.fired).toBe(true);
    });

    it("does NOT fire when the flag is missing", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.SLICING_MOVE } });
      const result = runCritStage({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.PUNCHING_MOVE }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("filter — both type and flag (intersection)", () => {
    it("fires only when both type and flag match", () => {
      const attr = new CritStageBonusAbAttr({
        bonus: 1,
        filter: { type: PokemonType.STEEL, flag: MoveFlags.SLICING_MOVE },
      });
      expect(
        runCritStage({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.STEEL, flags: MoveFlags.SLICING_MOVE }),
        }).fired,
      ).toBe(true);
      // Type matches, flag missing → no fire
      expect(
        runCritStage({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.STEEL }),
        }).fired,
      ).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured bonus and filter", () => {
      const filter: CritModFilter = { flag: MoveFlags.PUNCHING_MOVE };
      const attr = new CritStageBonusAbAttr({ bonus: 2, filter });
      expect(attr.getBonus()).toBe(2);
      expect(attr.getFilter()).toEqual(filter);
    });

    it("defaults filter to empty when omitted", () => {
      const attr = new CritStageBonusAbAttr({ bonus: 1 });
      expect(attr.getFilter()).toEqual({});
    });
  });

  describe("validation", () => {
    it("rejects bonus = 0", () => {
      expect(() => new CritStageBonusAbAttr({ bonus: 0 })).toThrow(/positive integer/);
    });

    it("rejects negative bonus", () => {
      expect(() => new CritStageBonusAbAttr({ bonus: -1 })).toThrow(/positive integer/);
    });

    it("rejects non-integer bonus", () => {
      expect(() => new CritStageBonusAbAttr({ bonus: 1.5 })).toThrow(/positive integer/);
    });

    it("rejects MoveFlags.NONE as the filter flag", () => {
      expect(() => new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.NONE } })).toThrow(
        /flag must be a non-NONE/,
      );
    });
  });

  describe("static matchesFilter", () => {
    it("returns true for an empty filter regardless of move", () => {
      const pokemon = makeStubPokemon();
      const move = makeStubMove({ type: PokemonType.GHOST });
      expect(CritStageBonusAbAttr.matchesFilter({}, pokemon, move)).toBe(true);
    });
  });
});

describe("CritDamageMultiplierAbAttr archetype (C1e)", () => {
  describe("apply behavior", () => {
    it("multiplies the crit-mult holder by 1.5 (Sniper-style)", () => {
      const attr = new CritDamageMultiplierAbAttr({ multiplier: 1.5 });
      const critMult = new NumberHolder(1.5); // pokerogue's default crit multiplier baseline
      const params = {
        pokemon: makeStubPokemon(),
        critMult,
        simulated: true,
      } as unknown as Parameters<CritDamageMultiplierAbAttr["apply"]>[0];
      expect(attr.canApply(params)).toBe(true);
      attr.apply(params);
      expect(critMult.value).toBeCloseTo(2.25);
    });
  });

  describe("canApply gating (inherited)", () => {
    it("does NOT fire when the crit-mult holder is ≤ 1 (no crit in flight)", () => {
      const attr = new CritDamageMultiplierAbAttr({ multiplier: 1.5 });
      const critMult = new NumberHolder(1);
      const params = {
        pokemon: makeStubPokemon(),
        critMult,
        simulated: true,
      } as unknown as Parameters<CritDamageMultiplierAbAttr["apply"]>[0];
      expect(attr.canApply(params)).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured multiplier", () => {
      const attr = new CritDamageMultiplierAbAttr({ multiplier: 2 });
      expect(attr.getMultiplier()).toBe(2);
    });
  });

  describe("validation", () => {
    it("rejects multiplier = 1 (no-op, semantic mistake)", () => {
      expect(() => new CritDamageMultiplierAbAttr({ multiplier: 1 })).toThrow(/must be > 1/);
    });

    it("rejects multiplier < 1 (this primitive amplifies)", () => {
      expect(() => new CritDamageMultiplierAbAttr({ multiplier: 0.5 })).toThrow(/must be > 1/);
    });

    it("rejects multiplier = 0", () => {
      expect(() => new CritDamageMultiplierAbAttr({ multiplier: 0 })).toThrow(/must be > 1/);
    });
  });
});

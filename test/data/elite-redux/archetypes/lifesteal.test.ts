/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: tests for the `lifesteal` archetype.
//
// The archetype carries two sibling subclasses:
//   - `LifestealOnHitAbAttr` — wraps PostAttackAbAttr. Tests cover filter
//     (type/flag/both/empty), damage > 0 gate, status-move exclusion,
//     validation, and accessors.
//   - `LifestealOnKoAbAttr`  — wraps PostKnockOutAbAttr. Tests cover the
//     "not fainted AND not at full HP" gate plus accessors and validation.
//
// Direct unit testing against duck-typed Pokemon/Move stubs. Apply is
// exercised with simulated=true so we don't touch the phase manager.
// =============================================================================

import { LifestealOnHitAbAttr, LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function makeStubAttacker(): Pokemon {
  return {
    id: 1,
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
  } as unknown as Pokemon;
}

function makeStubDefender(): Pokemon {
  return {
    id: 2,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { category?: MoveCategory; type?: PokemonType; flags?: MoveFlags } = {}): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    category: opts.category ?? MoveCategory.PHYSICAL,
    _type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

function runOnHit(opts: {
  attr: LifestealOnHitAbAttr;
  attacker?: Pokemon;
  defender?: Pokemon;
  move?: Move;
  damage?: number;
}): boolean {
  const params = {
    pokemon: opts.attacker ?? makeStubAttacker(),
    opponent: opts.defender ?? makeStubDefender(),
    move: opts.move ?? makeStubMove(),
    damage: opts.damage ?? 50,
    hitResult: 1,
    simulated: true,
  } as unknown as Parameters<LifestealOnHitAbAttr["canApply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return canFire;
}

describe("LifestealOnHitAbAttr archetype (C1e)", () => {
  describe("basic apply behavior", () => {
    it("fires on a damaging move with positive damage (Energy-Siphon-style)", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25 });
      expect(runOnHit({ attr, damage: 100 })).toBe(true);
    });

    it("does NOT fire when damage = 0 (immune / sub-blocked)", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25 });
      expect(runOnHit({ attr, damage: 0 })).toBe(false);
    });

    it("does NOT fire on a status move (parent's attackCondition)", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25 });
      expect(runOnHit({ attr, move: makeStubMove({ category: MoveCategory.STATUS }), damage: 50 })).toBe(false);
    });
  });

  describe("filter — type-keyed", () => {
    it("fires on a matching type (Hydro-Circuit-style Water filter)", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25, filter: { type: PokemonType.WATER } });
      expect(
        runOnHit({
          attr,
          move: makeStubMove({ type: PokemonType.WATER }),
          damage: 100,
        }),
      ).toBe(true);
    });

    it("does NOT fire on a different type", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25, filter: { type: PokemonType.WATER } });
      expect(
        runOnHit({
          attr,
          move: makeStubMove({ type: PokemonType.FIRE }),
          damage: 100,
        }),
      ).toBe(false);
    });
  });

  describe("filter — flag-keyed", () => {
    it("fires on a matching flag (biting-move-style filter)", () => {
      const attr = new LifestealOnHitAbAttr({
        healFraction: 0.25,
        filter: { flag: MoveFlags.BITING_MOVE },
      });
      expect(
        runOnHit({
          attr,
          move: makeStubMove({ flags: MoveFlags.BITING_MOVE }),
          damage: 100,
        }),
      ).toBe(true);
    });

    it("does NOT fire when flag is missing", () => {
      const attr = new LifestealOnHitAbAttr({
        healFraction: 0.25,
        filter: { flag: MoveFlags.BITING_MOVE },
      });
      expect(
        runOnHit({
          attr,
          move: makeStubMove({ flags: MoveFlags.PUNCHING_MOVE }),
          damage: 100,
        }),
      ).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured heal fraction and filter", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.125, filter: { flag: MoveFlags.BITING_MOVE } });
      expect(attr.getHealFraction()).toBe(0.125);
      expect(attr.getFilter()).toEqual({ flag: MoveFlags.BITING_MOVE });
    });

    it("defaults filter to empty when omitted", () => {
      const attr = new LifestealOnHitAbAttr({ healFraction: 0.25 });
      expect(attr.getFilter()).toEqual({});
    });
  });

  describe("validation", () => {
    it("rejects healFraction = 0", () => {
      expect(() => new LifestealOnHitAbAttr({ healFraction: 0 })).toThrow(/must be in/);
    });

    it("rejects negative healFraction", () => {
      expect(() => new LifestealOnHitAbAttr({ healFraction: -0.1 })).toThrow(/must be in/);
    });

    it("rejects healFraction > 1", () => {
      expect(() => new LifestealOnHitAbAttr({ healFraction: 1.5 })).toThrow(/must be in/);
    });

    it("rejects MoveFlags.NONE as the filter flag", () => {
      expect(() => new LifestealOnHitAbAttr({ healFraction: 0.25, filter: { flag: MoveFlags.NONE } })).toThrow(
        /flag must be a non-NONE/,
      );
    });
  });

  describe("static matchesFilter", () => {
    it("returns true for an empty filter regardless of move", () => {
      expect(
        LifestealOnHitAbAttr.matchesFilter({}, makeStubAttacker(), makeStubMove({ type: PokemonType.GHOST })),
      ).toBe(true);
    });
  });
});

describe("LifestealOnKoAbAttr archetype (C1e)", () => {
  function makeStubKoer(opts: { fullHp?: boolean; fainted?: boolean } = {}): Pokemon {
    return {
      isFullHp: () => opts.fullHp ?? false,
      isFainted: () => opts.fainted ?? false,
    } as unknown as Pokemon;
  }

  function runOnKo(opts: { attr: LifestealOnKoAbAttr; pokemon: Pokemon; victim?: Pokemon }): boolean {
    const params = {
      pokemon: opts.pokemon,
      victim: opts.victim ?? makeStubDefender(),
      simulated: true,
    } as unknown as Parameters<LifestealOnKoAbAttr["canApply"]>[0];
    return opts.attr.canApply(params);
  }

  describe("apply gate", () => {
    it("fires when the user is alive AND below full HP (Soul-Eater-style)", () => {
      const attr = new LifestealOnKoAbAttr({ healFraction: 0.25 });
      expect(runOnKo({ attr, pokemon: makeStubKoer({ fullHp: false, fainted: false }) })).toBe(true);
    });

    it("does NOT fire when the user is at full HP (no healing needed)", () => {
      const attr = new LifestealOnKoAbAttr({ healFraction: 0.25 });
      expect(runOnKo({ attr, pokemon: makeStubKoer({ fullHp: true }) })).toBe(false);
    });

    it("does NOT fire when the user is fainted", () => {
      const attr = new LifestealOnKoAbAttr({ healFraction: 0.25 });
      expect(runOnKo({ attr, pokemon: makeStubKoer({ fainted: true }) })).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured heal fraction", () => {
      const attr = new LifestealOnKoAbAttr({ healFraction: 0.25 });
      expect(attr.getHealFraction()).toBe(0.25);
    });
  });

  describe("validation", () => {
    it("rejects healFraction = 0", () => {
      expect(() => new LifestealOnKoAbAttr({ healFraction: 0 })).toThrow(/must be in/);
    });

    it("rejects negative healFraction", () => {
      expect(() => new LifestealOnKoAbAttr({ healFraction: -0.1 })).toThrow(/must be in/);
    });

    it("rejects healFraction > 1", () => {
      expect(() => new LifestealOnKoAbAttr({ healFraction: 2 })).toThrow(/must be in/);
    });
  });
});

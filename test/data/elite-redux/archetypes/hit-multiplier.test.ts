/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: tests for the `hit-multiplier` archetype.
//
// The archetype carries two sibling subclasses:
//   - `HitMultiplierAbAttr`        — adds extra strikes via the
//     AddSecondStrikeAbAttr parent. Tests cover filter (type/flag/both/empty),
//     multi-extra-strike configurations, validation, and accessors.
//   - `HitMultiplierPowerAbAttr`   — applies a damage multiplier via
//     MoveDamageBoostAbAttr. Tests cover filter matching and validation
//     (the parent's apply uses NumberHolders we can poke directly).
//
// Direct unit testing against duck-typed Pokemon/Move stubs; no full battle
// harness required.
// =============================================================================

import {
  HitMultiplierAbAttr,
  type HitMultiplierFilter,
  HitMultiplierPowerAbAttr,
} from "#data/elite-redux/archetypes/hit-multiplier";
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

function makeStubMove(opts: { type?: PokemonType; flags?: MoveFlags; canMultiStrike?: boolean }): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    _type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
    canBeMultiStrikeEnhanced: () => opts.canMultiStrike ?? true,
  } as unknown as Move;
}

function runHits(opts: { attr: HitMultiplierAbAttr; pokemon: Pokemon; move: Move; initialHits?: number }): {
  fired: boolean;
  finalHits: number;
} {
  const hitCount = new NumberHolder(opts.initialHits ?? 1);
  const params = {
    pokemon: opts.pokemon,
    opponent: opts.pokemon,
    move: opts.move,
    hitCount,
    simulated: true,
  } as unknown as Parameters<HitMultiplierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalHits: hitCount.value };
}

describe("HitMultiplierAbAttr archetype (C1d)", () => {
  describe("strike-count behavior", () => {
    it("adds one extra strike on a matching move (Parental-Bond-style)", () => {
      const attr = new HitMultiplierAbAttr({ extraStrikes: 1 });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({}),
      });
      expect(result.fired).toBe(true);
      expect(result.finalHits).toBe(2);
    });

    it("adds two extra strikes when extraStrikes=2", () => {
      const attr = new HitMultiplierAbAttr({ extraStrikes: 2 });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({}),
      });
      expect(result.fired).toBe(true);
      expect(result.finalHits).toBe(3);
    });
  });

  describe("filter — type-keyed", () => {
    it("fires on a matching type", () => {
      const attr = new HitMultiplierAbAttr({
        extraStrikes: 1,
        filter: { type: PokemonType.FIRE },
      });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.FIRE }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalHits).toBe(2);
    });

    it("does NOT fire on a different type", () => {
      const attr = new HitMultiplierAbAttr({
        extraStrikes: 1,
        filter: { type: PokemonType.FIRE },
      });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.GRASS }),
      });
      expect(result.fired).toBe(false);
      expect(result.finalHits).toBe(1);
    });
  });

  describe("filter — flag-keyed", () => {
    it("fires on a matching flag (Raging-Boxer-style)", () => {
      const attr = new HitMultiplierAbAttr({
        extraStrikes: 1,
        filter: { flag: MoveFlags.PUNCHING_MOVE },
      });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.PUNCHING_MOVE }),
      });
      expect(result.fired).toBe(true);
    });

    it("does NOT fire when the flag is missing", () => {
      const attr = new HitMultiplierAbAttr({
        extraStrikes: 1,
        filter: { flag: MoveFlags.BITING_MOVE },
      });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.PUNCHING_MOVE }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("filter — both type and flag (intersection)", () => {
    it("fires only when both type and flag match", () => {
      const attr = new HitMultiplierAbAttr({
        extraStrikes: 1,
        filter: { type: PokemonType.FIRE, flag: MoveFlags.PUNCHING_MOVE },
      });
      // Both match → fires
      expect(
        runHits({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.FIRE, flags: MoveFlags.PUNCHING_MOVE }),
        }).fired,
      ).toBe(true);
      // Type matches, flag doesn't → no fire
      expect(
        runHits({
          attr,
          pokemon: makeStubPokemon(),
          move: makeStubMove({ type: PokemonType.FIRE, flags: MoveFlags.BITING_MOVE }),
        }).fired,
      ).toBe(false);
    });
  });

  describe("canBeMultiStrikeEnhanced gate (inherited)", () => {
    it("does NOT fire when move.canBeMultiStrikeEnhanced is false", () => {
      const attr = new HitMultiplierAbAttr({ extraStrikes: 1 });
      const result = runHits({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ canMultiStrike: false }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured extra-strike count and filter", () => {
      const filter: HitMultiplierFilter = { flag: MoveFlags.SLICING_MOVE };
      const attr = new HitMultiplierAbAttr({ extraStrikes: 2, filter });
      expect(attr.getExtraStrikes()).toBe(2);
      expect(attr.getFilter()).toEqual(filter);
    });

    it("defaults filter to empty when omitted", () => {
      const attr = new HitMultiplierAbAttr({ extraStrikes: 1 });
      expect(attr.getFilter()).toEqual({});
    });
  });

  describe("validation", () => {
    it("rejects extraStrikes = 0", () => {
      expect(() => new HitMultiplierAbAttr({ extraStrikes: 0 })).toThrow(/must be a positive integer/);
    });

    it("rejects negative extraStrikes", () => {
      expect(() => new HitMultiplierAbAttr({ extraStrikes: -1 })).toThrow(/must be a positive integer/);
    });

    it("rejects non-integer extraStrikes", () => {
      expect(() => new HitMultiplierAbAttr({ extraStrikes: 1.5 })).toThrow(/must be a positive integer/);
    });

    it("rejects MoveFlags.NONE as the filter flag", () => {
      expect(() => new HitMultiplierAbAttr({ extraStrikes: 1, filter: { flag: MoveFlags.NONE } })).toThrow(
        /flag must be a non-NONE/,
      );
    });
  });
});

describe("HitMultiplierPowerAbAttr archetype (C1d)", () => {
  describe("filter matching", () => {
    it("returns matchesFilter true for a matching type", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.4, filter: { type: PokemonType.FIRE } });
      const pokemon = makeStubPokemon();
      const move = makeStubMove({ type: PokemonType.FIRE });
      expect(HitMultiplierAbAttr.matchesFilter(attr.getFilter(), pokemon, move)).toBe(true);
    });

    it("returns matchesFilter false for a mismatching type", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.4, filter: { type: PokemonType.FIRE } });
      const pokemon = makeStubPokemon();
      const move = makeStubMove({ type: PokemonType.GRASS });
      expect(HitMultiplierAbAttr.matchesFilter(attr.getFilter(), pokemon, move)).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured multiplier and filter", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.7, filter: { flag: MoveFlags.PUNCHING_MOVE } });
      expect(attr.getMultiplier()).toBe(0.7);
      expect(attr.getFilter()).toEqual({ flag: MoveFlags.PUNCHING_MOVE });
    });

    it("multiplier = 1 is accepted (boundary)", () => {
      expect(() => new HitMultiplierPowerAbAttr({ multiplier: 1 })).not.toThrow();
    });
  });

  describe("validation", () => {
    it("rejects multiplier = 0", () => {
      expect(() => new HitMultiplierPowerAbAttr({ multiplier: 0 })).toThrow(/must be > 0/);
    });

    it("rejects negative multiplier", () => {
      expect(() => new HitMultiplierPowerAbAttr({ multiplier: -0.5 })).toThrow(/must be > 0/);
    });

    it("rejects multiplier > 1 (this is the scale-down primitive)", () => {
      expect(() => new HitMultiplierPowerAbAttr({ multiplier: 1.5 })).toThrow(/must be ≤ 1/);
    });

    it("rejects MoveFlags.NONE as the filter flag", () => {
      expect(() => new HitMultiplierPowerAbAttr({ multiplier: 0.4, filter: { flag: MoveFlags.NONE } })).toThrow(
        /flag must be a non-NONE/,
      );
    });
  });

  // The faithful "1st hit 100%, 2nd hit at N%" behaviour (Hyper Aggressive,
  // Raging Boxer, Primal Maw). The parent `MoveDamageBoostAbAttr.canApply`
  // evaluates the condition per strike; `extraStrikesOnly` gates it on the live
  // strike index read from `turnData.{hitCount,hitsLeft}` so the first strike is
  // left at full power.
  describe("extraStrikesOnly per-strike gating", () => {
    /** Stub a Pokemon mid-attack on strike `strikeIndex` (0-based) of `hitCount` total. */
    function makeAttackingStub(hitCount: number, strikeIndex: number): Pokemon {
      return {
        id: 1,
        getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
        turnData: { hitCount, hitsLeft: hitCount - strikeIndex },
      } as unknown as Pokemon;
    }

    function canApplyOnStrike(attr: HitMultiplierPowerAbAttr, hitCount: number, strikeIndex: number): boolean {
      const params = {
        pokemon: makeAttackingStub(hitCount, strikeIndex),
        opponent: makeStubPokemon(),
        move: makeStubMove({}),
        damage: new NumberHolder(100),
        simulated: true,
      } as unknown as Parameters<HitMultiplierPowerAbAttr["canApply"]>[0];
      return attr.canApply(params);
    }

    it("does NOT scale the first strike (stays 100%)", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.25, extraStrikesOnly: true });
      expect(canApplyOnStrike(attr, 2, 0)).toBe(false);
    });

    it("scales the second strike (the 25% hit)", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.25, extraStrikesOnly: true });
      expect(canApplyOnStrike(attr, 2, 1)).toBe(true);
    });

    it("default (uniform) mode scales every strike including the first", () => {
      const attr = new HitMultiplierPowerAbAttr({ multiplier: 0.7 });
      expect(canApplyOnStrike(attr, 2, 0)).toBe(true);
      expect(canApplyOnStrike(attr, 2, 1)).toBe(true);
    });

    it("exposes isExtraStrikesOnly()", () => {
      expect(new HitMultiplierPowerAbAttr({ multiplier: 0.25, extraStrikesOnly: true }).isExtraStrikesOnly()).toBe(
        true,
      );
      expect(new HitMultiplierPowerAbAttr({ multiplier: 0.7 }).isExtraStrikesOnly()).toBe(false);
    });
  });
});

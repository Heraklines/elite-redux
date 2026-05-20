/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: tests for the `priority-modifier` archetype.
//
// We exercise the archetype primitive directly. The constructor wires a
// `(pokemon, move) => boolean` closure into pokerogue's
// `ChangeMovePriorityAbAttr` parent; the parent's `canApply` calls that
// closure, and `apply` adds the configured delta to the priority holder.
//
// Tests cover the filter (type / flag / both / neither), the conditions
// (`always`, `full-hp`, `low-hp` with default + custom threshold), the
// priority delta semantics (positive / negative), and construction validation.
// =============================================================================

import { PriorityModifierAbAttr } from "#data/elite-redux/archetypes/priority-modifier";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeStubPokemon(opts: { hpRatio?: number; fullHp?: boolean } = {}): Pokemon {
  const hpRatio = opts.hpRatio ?? 1;
  return {
    getHpRatio: () => hpRatio,
    isFullHp: () => opts.fullHp ?? hpRatio === 1,
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

function runPriority(opts: { attr: PriorityModifierAbAttr; pokemon: Pokemon; move: Move; initialPriority?: number }): {
  fired: boolean;
  finalPriority: number;
} {
  const priority = new NumberHolder(opts.initialPriority ?? 0);
  const params = {
    pokemon: opts.pokemon,
    move: opts.move,
    priority,
    simulated: true,
  } as unknown as Parameters<PriorityModifierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPriority: priority.value };
}

describe("PriorityModifierAbAttr archetype (C1c)", () => {
  describe("type-keyed filter", () => {
    it("Galeforce-Wings-style: +1 priority for Flying moves", () => {
      const attr = new PriorityModifierAbAttr({ priority: 1, filter: { type: PokemonType.FLYING } });
      const result = runPriority({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.FLYING }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalPriority).toBe(1);
    });

    it("does NOT fire for moves of a different type", () => {
      const attr = new PriorityModifierAbAttr({ priority: 1, filter: { type: PokemonType.FLYING } });
      const result = runPriority({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ type: PokemonType.NORMAL }),
      });
      expect(result.fired).toBe(false);
      expect(result.finalPriority).toBe(0);
    });
  });

  describe("flag-keyed filter", () => {
    it("Blitz-Boxer-style: +1 priority for punching moves", () => {
      const attr = new PriorityModifierAbAttr({
        priority: 1,
        filter: { flag: MoveFlags.PUNCHING_MOVE },
      });
      const result = runPriority({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.PUNCHING_MOVE }),
      });
      expect(result.fired).toBe(true);
      expect(result.finalPriority).toBe(1);
    });

    it("does NOT fire for moves missing the configured flag", () => {
      const attr = new PriorityModifierAbAttr({ priority: 1, filter: { flag: MoveFlags.PUNCHING_MOVE } });
      const result = runPriority({
        attr,
        pokemon: makeStubPokemon(),
        move: makeStubMove({ flags: MoveFlags.SLICING_MOVE }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("HP-gated conditions", () => {
    it("Flaming-Soul-style: full-HP condition gates the bonus", () => {
      const attr = new PriorityModifierAbAttr({
        priority: 1,
        filter: { type: PokemonType.FIRE },
        condition: { kind: "full-hp" },
      });
      // Full HP → fires
      expect(
        runPriority({
          attr,
          pokemon: makeStubPokemon({ fullHp: true, hpRatio: 1 }),
          move: makeStubMove({ type: PokemonType.FIRE }),
        }).fired,
      ).toBe(true);
      // Damaged → no fire
      expect(
        runPriority({
          attr,
          pokemon: makeStubPokemon({ fullHp: false, hpRatio: 0.99 }),
          move: makeStubMove({ type: PokemonType.FIRE }),
        }).fired,
      ).toBe(false);
    });

    it("low-HP condition fires at-or-below threshold", () => {
      const attr = new PriorityModifierAbAttr({
        priority: 1,
        filter: { type: PokemonType.GRASS },
        condition: { kind: "low-hp", threshold: 0.33 },
      });
      // Below threshold → fires
      expect(
        runPriority({
          attr,
          pokemon: makeStubPokemon({ hpRatio: 0.3 }),
          move: makeStubMove({ type: PokemonType.GRASS }),
        }).fired,
      ).toBe(true);
      // At threshold (boundary inclusive) → fires
      expect(
        runPriority({
          attr,
          pokemon: makeStubPokemon({ hpRatio: 0.33 }),
          move: makeStubMove({ type: PokemonType.GRASS }),
        }).fired,
      ).toBe(true);
      // Above threshold → no fire
      expect(
        runPriority({
          attr,
          pokemon: makeStubPokemon({ hpRatio: 0.5 }),
          move: makeStubMove({ type: PokemonType.GRASS }),
        }).fired,
      ).toBe(false);
    });

    it("low-HP defaults threshold to 0.5", () => {
      const attr = new PriorityModifierAbAttr({
        priority: 1,
        condition: { kind: "low-hp" },
      });
      expect(runPriority({ attr, pokemon: makeStubPokemon({ hpRatio: 0.5 }), move: makeStubMove() }).fired).toBe(true);
      expect(runPriority({ attr, pokemon: makeStubPokemon({ hpRatio: 0.51 }), move: makeStubMove() }).fired).toBe(
        false,
      );
    });
  });

  describe("empty filter + always condition", () => {
    it("fires for any move when no filter and no condition are configured", () => {
      const attr = new PriorityModifierAbAttr({ priority: 1 });
      expect(runPriority({ attr, pokemon: makeStubPokemon(), move: makeStubMove() }).fired).toBe(true);
    });
  });

  describe("negative priority delta", () => {
    it("supports negative priority (Stall-style)", () => {
      const attr = new PriorityModifierAbAttr({ priority: -1 });
      const result = runPriority({ attr, pokemon: makeStubPokemon(), move: makeStubMove(), initialPriority: 0 });
      expect(result.fired).toBe(true);
      expect(result.finalPriority).toBe(-1);
    });
  });

  describe("accessors", () => {
    it("exposes the configuration via getters", () => {
      const attr = new PriorityModifierAbAttr({
        priority: 1,
        filter: { type: PokemonType.FLYING, flag: MoveFlags.SOUND_BASED },
        condition: { kind: "full-hp" },
      });
      expect(attr.getPriority()).toBe(1);
      expect(attr.getFilter()).toEqual({ type: PokemonType.FLYING, flag: MoveFlags.SOUND_BASED });
      expect(attr.getPriorityCondition()).toEqual({ kind: "full-hp" });
    });
  });

  describe("validation", () => {
    it("rejects priority of 0", () => {
      expect(() => new PriorityModifierAbAttr({ priority: 0 })).toThrow(/priority must be a non-zero integer/);
    });

    it("rejects non-integer priority", () => {
      expect(() => new PriorityModifierAbAttr({ priority: 0.5 })).toThrow(/priority must be a non-zero integer/);
    });

    it("rejects MoveFlags.NONE as the filter flag", () => {
      expect(() => new PriorityModifierAbAttr({ priority: 1, filter: { flag: MoveFlags.NONE } })).toThrow(
        /flag must be a non-NONE/,
      );
    });

    it("rejects out-of-range low-HP thresholds", () => {
      expect(() => new PriorityModifierAbAttr({ priority: 1, condition: { kind: "low-hp", threshold: 0 } })).toThrow(
        /threshold must be in/,
      );
      expect(() => new PriorityModifierAbAttr({ priority: 1, condition: { kind: "low-hp", threshold: 1.5 } })).toThrow(
        /threshold must be in/,
      );
    });
  });
});

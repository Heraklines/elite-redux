/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: tests for the `move-replacement` archetype.
//
// Covers the two sibling subclasses:
//   - MovesetReplacementAbAttr (PostSummon surface — replaces moveset slots)
//   - MoveTypeReplacementAbAttr (PreAttack MoveType filter — retypes moves)
//
// Direct unit testing — full dispatcher integration deferred.
// =============================================================================

import { MovesetReplacementAbAttr, MoveTypeReplacementAbAttr } from "#data/elite-redux/archetypes/move-replacement";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

describe("MovesetReplacementAbAttr", () => {
  it("constructs with a single-entry replacement map", () => {
    const map = new Map<MoveId, MoveId>([[MoveId.TACKLE, MoveId.POUND]]);
    const attr = new MovesetReplacementAbAttr({ replaceMap: map });
    expect(attr.getReplaceMap().size).toBe(1);
    expect(attr.getReplaceMap().get(MoveId.TACKLE)).toBe(MoveId.POUND);
  });

  it("constructs with a multi-entry map", () => {
    const map = new Map<MoveId, MoveId>([
      [MoveId.TACKLE, MoveId.POUND],
      [MoveId.SCRATCH, MoveId.EMBER],
    ]);
    const attr = new MovesetReplacementAbAttr({ replaceMap: map });
    expect(attr.getReplaceMap().size).toBe(2);
  });

  it("rejects empty replacement map", () => {
    expect(() => new MovesetReplacementAbAttr({ replaceMap: new Map() })).toThrow(/at least one entry/);
  });

  it("rejects no-op mapping (source === target)", () => {
    const map = new Map<MoveId, MoveId>([[MoveId.TACKLE, MoveId.TACKLE]]);
    expect(() => new MovesetReplacementAbAttr({ replaceMap: map })).toThrow(/no-op mapping/);
  });

  it("rejects map containing both valid and no-op mappings", () => {
    const map = new Map<MoveId, MoveId>([
      [MoveId.TACKLE, MoveId.POUND],
      [MoveId.EMBER, MoveId.EMBER],
    ]);
    expect(() => new MovesetReplacementAbAttr({ replaceMap: map })).toThrow(/no-op mapping/);
  });
});

describe("MoveTypeReplacementAbAttr", () => {
  it("constructs with a single-move filter", () => {
    const attr = new MoveTypeReplacementAbAttr({
      moves: [MoveId.TACKLE],
      newType: PokemonType.STEEL,
    });
    expect(attr.getMoves().has(MoveId.TACKLE)).toBe(true);
    expect(attr.getNewType()).toBe(PokemonType.STEEL);
  });

  it("constructs with a multi-move filter", () => {
    const attr = new MoveTypeReplacementAbAttr({
      moves: [MoveId.TACKLE, MoveId.SCRATCH, MoveId.POUND],
      newType: PokemonType.FAIRY,
    });
    expect(attr.getMoves().size).toBe(3);
    expect(attr.getMoves().has(MoveId.POUND)).toBe(true);
  });

  it("deduplicates duplicate moves into the Set", () => {
    const attr = new MoveTypeReplacementAbAttr({
      moves: [MoveId.TACKLE, MoveId.TACKLE, MoveId.SCRATCH],
      newType: PokemonType.STEEL,
    });
    expect(attr.getMoves().size).toBe(2);
  });

  it("rejects empty move filter", () => {
    expect(() => new MoveTypeReplacementAbAttr({ moves: [], newType: PokemonType.STEEL })).toThrow(
      /at least one MoveId/,
    );
  });

  it("getMoves returns a read-only set view of the configured moves", () => {
    const attr = new MoveTypeReplacementAbAttr({
      moves: [MoveId.TACKLE],
      newType: PokemonType.STEEL,
    });
    // Membership check works correctly
    expect(attr.getMoves().has(MoveId.TACKLE)).toBe(true);
    expect(attr.getMoves().has(MoveId.POUND)).toBe(false);
  });
});

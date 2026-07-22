/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - SEARCH OPERATORS matrix (P3). The move-pane metadata filters
// (`type:fire`, `cat:phys`, `bp>90`, `acc=100`, `pp<=10`) + the load-bearing BYTE-IDENTICAL
// guarantee: any query with no recognized operator token parses to `operators: []` with the
// ORIGINAL string as residual, so the caller's plain `rankByFilter` path is untouched.
// PURE (enum-only imports) - no engine boot.
// =============================================================================

import {
  type MoveSearchMeta,
  matchesMoveSearch,
  parseMoveSearch,
} from "#data/elite-redux/showdown/showdown-search-operators";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

const mk = (over: Partial<MoveSearchMeta>): MoveSearchMeta => ({
  type: PokemonType.NORMAL,
  power: 0,
  accuracy: 100,
  category: MoveCategory.STATUS,
  pp: 10,
  ...over,
});

const flamethrower = mk({ type: PokemonType.FIRE, power: 90, accuracy: 100, category: MoveCategory.SPECIAL, pp: 15 });
const fireBlast = mk({ type: PokemonType.FIRE, power: 110, accuracy: 85, category: MoveCategory.SPECIAL, pp: 5 });
const flareBlitz = mk({ type: PokemonType.FIRE, power: 120, accuracy: 100, category: MoveCategory.PHYSICAL, pp: 15 });
const earthquake = mk({ type: PokemonType.GROUND, power: 100, accuracy: 100, category: MoveCategory.PHYSICAL, pp: 10 });
const willOWisp = mk({ type: PokemonType.FIRE, power: 0, accuracy: 85, category: MoveCategory.STATUS, pp: 15 });

const POOL = { flamethrower, fireBlast, flareBlitz, earthquake, willOWisp };
const matches = (filter: string): string[] => {
  const parsed = parseMoveSearch(filter);
  return Object.entries(POOL)
    .filter(([, meta]) => matchesMoveSearch(meta, parsed))
    .map(([name]) => name);
};

describe("showdown search operators - byte-identical plain-query guarantee", () => {
  it.each([
    "",
    "flame",
    "stone edge",
    "fire blast",
    "u-turn",
    "king's shield",
    "e",
  ])("a plain query (%j) parses to no operators and the ORIGINAL string as residual", filter => {
    const parsed = parseMoveSearch(filter);
    expect(parsed.operators).toEqual([]);
    expect(parsed.residual).toBe(filter);
  });

  it("an unknown key is NOT an operator (falls through to residual)", () => {
    const parsed = parseMoveSearch("foo:bar");
    expect(parsed.operators).toEqual([]);
    expect(parsed.residual).toBe("foo:bar");
  });

  it("a categorical key with a numeric comparator is NOT an operator (type>fire)", () => {
    const parsed = parseMoveSearch("type>fire");
    expect(parsed.operators).toEqual([]);
    expect(parsed.residual).toBe("type>fire");
  });

  it("an unresolvable type value is NOT an operator (type:notatype)", () => {
    const parsed = parseMoveSearch("type:notatype");
    expect(parsed.operators).toEqual([]);
  });
});

describe("showdown search operators - the operator matrix", () => {
  it("type:fire keeps only fire moves (drops the ground move)", () => {
    expect(matches("type:fire").sort()).toEqual(["fireBlast", "flamethrower", "flareBlitz", "willOWisp"]);
  });

  it("type:fire (case-insensitive) matches all fire-typed moves and drops the ground move", () => {
    const r = matches("TYPE:Fire");
    expect(r).toContain("flamethrower");
    expect(r).toContain("fireBlast");
    expect(r).toContain("flareBlitz");
    expect(r).toContain("willOWisp");
    expect(r).not.toContain("earthquake");
  });

  it("cat:phys keeps only physical moves", () => {
    expect(matches("cat:phys").sort()).toEqual(["earthquake", "flareBlitz"]);
  });

  it("cat:special keeps only special moves", () => {
    expect(matches("cat:special").sort()).toEqual(["fireBlast", "flamethrower"]);
  });

  it("cat:status keeps only status moves", () => {
    expect(matches("cat:status")).toEqual(["willOWisp"]);
  });

  it("bp>90 keeps moves stronger than 90 (strict)", () => {
    expect(matches("bp>90").sort()).toEqual(["earthquake", "fireBlast", "flareBlitz"]);
  });

  it("bp>=90 includes the 90-power move", () => {
    expect(matches("bp>=90").sort()).toEqual(["earthquake", "fireBlast", "flamethrower", "flareBlitz"]);
  });

  it("bp=100 is an exact match", () => {
    expect(matches("bp=100")).toEqual(["earthquake"]);
  });

  it("bp:100 (colon alias for equals) matches the same", () => {
    expect(matches("bp:100")).toEqual(["earthquake"]);
  });

  it("acc=100 keeps only perfectly accurate moves", () => {
    expect(matches("acc=100").sort()).toEqual(["earthquake", "flamethrower", "flareBlitz"]);
  });

  it("acc<90 keeps the shaky-accuracy moves", () => {
    expect(matches("acc<90").sort()).toEqual(["fireBlast", "willOWisp"]);
  });

  it("pp<=5 keeps the low-PP move", () => {
    expect(matches("pp<=5")).toEqual(["fireBlast"]);
  });

  it("multiple operators AND together: type:fire bp>=100 cat:special", () => {
    expect(matches("type:fire bp>=100 cat:special")).toEqual(["fireBlast"]);
  });

  it("operator + residual plain text: the residual is preserved for name ranking", () => {
    const parsed = parseMoveSearch("type:fire blast");
    expect(parsed.operators.length).toBe(1);
    expect(parsed.residual).toBe("blast");
  });
});

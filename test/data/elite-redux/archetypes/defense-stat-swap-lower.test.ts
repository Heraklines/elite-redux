/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Unit tests for the "target-lower-defense" swap variant of
// DefenseStatSwapOnFlagAbAttr (Roundhouse 403: "kicks damage the foe's weaker
// defense"). The move is routed (via the power-ratio approximation) to whichever
// of the target's DEF/SPDEF is lower.
import { DefenseStatSwapOnFlagAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-flag";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeMove(category: MoveCategory, hasKick = true): Move {
  return {
    category,
    hasFlag: (f: MoveFlags) => hasKick && f === MoveFlags.KICKING_MOVE,
  } as unknown as Move;
}

function makeTarget(def: number, spdef: number): Pokemon {
  return {
    getStat: (stat: Stat) => (stat === Stat.DEF ? def : stat === Stat.SPDEF ? spdef : 0),
  } as unknown as Pokemon;
}

function runPower(attr: DefenseStatSwapOnFlagAbAttr, move: Move, target: Pokemon, base = 100): number {
  const power = new NumberHolder(base);
  attr.apply({ opponent: target, move, power } as unknown as Parameters<DefenseStatSwapOnFlagAbAttr["apply"]>[0]);
  return power.value;
}

describe("DefenseStatSwapOnFlagAbAttr target-lower-defense (Roundhouse)", () => {
  const attr = new DefenseStatSwapOnFlagAbAttr({ flag: MoveFlags.KICKING_MOVE, swap: "target-lower-defense" });

  it("physical move routes to SPDEF when SPDEF is lower (power scaled up by def/spdef)", () => {
    // DEF 200, SPDEF 100 → physical normally hits DEF; reroute to lower SPDEF → ×2.
    expect(runPower(attr, makeMove(MoveCategory.PHYSICAL), makeTarget(200, 100), 100)).toBeCloseTo(200);
  });

  it("physical move unchanged when DEF is already the lower stat", () => {
    expect(runPower(attr, makeMove(MoveCategory.PHYSICAL), makeTarget(100, 200), 100)).toBeCloseTo(100);
  });

  it("special move routes to DEF when DEF is lower (power scaled up by spdef/def)", () => {
    expect(runPower(attr, makeMove(MoveCategory.SPECIAL), makeTarget(100, 200), 100)).toBeCloseTo(200);
  });

  it("does nothing for a move without the kicking flag", () => {
    expect(runPower(attr, makeMove(MoveCategory.PHYSICAL, false), makeTarget(200, 100), 100)).toBeCloseTo(100);
  });
});

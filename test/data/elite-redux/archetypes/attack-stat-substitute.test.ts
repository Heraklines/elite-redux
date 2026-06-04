/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Tests for the `attack-stat-substitute` archetype's resolveStat, focusing on
// the optional move-flag gate added for the "flagged moves use SpAtk" cluster
// (Mind Crunch BITING, Mystic Blades SLICING, Mythical Arrows ARROW).

import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function makeMove(flags: MoveFlags): Move {
  return {
    hasFlag: (flag: MoveFlags) => (flags & flag) !== MoveFlags.NONE,
  } as unknown as Move;
}

const SOURCE = {} as unknown as Pokemon;

describe("AttackStatSubstituteAbAttr — flag gate", () => {
  it("substitutes SpAtk for a physical move carrying the gated flag", () => {
    const attr = new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.BITING_MOVE });
    expect(attr.resolveStat(makeMove(MoveFlags.BITING_MOVE), true, SOURCE)).toBe(Stat.SPATK);
  });

  it("does NOT substitute for a physical move missing the gated flag", () => {
    const attr = new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.BITING_MOVE });
    expect(attr.resolveStat(makeMove(MoveFlags.PUNCHING_MOVE), true, SOURCE)).toBeNull();
  });

  it("without a flag, substitutes for every physical move (unchanged behavior)", () => {
    const attr = new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK });
    expect(attr.resolveStat(makeMove(MoveFlags.NONE), true, SOURCE)).toBe(Stat.SPATK);
  });
});

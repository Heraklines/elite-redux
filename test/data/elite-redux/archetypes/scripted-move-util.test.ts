/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { FirstMoveCondition } from "#data/moves/move-condition";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

describe("scriptedPokemonMove", () => {
  it("can bypass Astonish's first-turn condition without mutating the registered move", () => {
    const registered = allMoves[MoveId.ASTONISH] as unknown as { conditionsSeq3: unknown[]; power: number };
    const originalConditions = registered.conditionsSeq3.slice();
    const scripted = scriptedPokemonMove(MoveId.ASTONISH, 40, {
      bypassFirstMoveCondition: true,
    }).getMove() as unknown as { conditionsSeq3: unknown[]; power: number };

    expect(scripted.power).toBe(40);
    expect(scripted.conditionsSeq3.some(condition => condition instanceof FirstMoveCondition)).toBe(false);
    expect(registered.conditionsSeq3).toEqual(originalConditions);
    expect(registered.conditionsSeq3.some(condition => condition instanceof FirstMoveCondition)).toBe(true);
  });
});

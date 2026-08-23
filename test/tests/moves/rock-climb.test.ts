/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

describe("Moves - Rock Climb", () => {
  it("is a charging move with its confusion rider", () => {
    const move = allMoves[MoveId.ROCK_CLIMB];

    expect(move.isChargingMove()).toBe(true);
    expect(move.hasAttr("ConfuseAttr")).toBe(true);
  });
});

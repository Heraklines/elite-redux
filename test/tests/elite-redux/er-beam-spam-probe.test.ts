/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Item 9 regression: the Beam Spam achievement and Mega Launcher's damage boost
// must share ONE runtime predicate - the PULSE_MOVE flag - and the moves that
// the ER 2.65 dex tags "Mega Launcher boost" must actually carry that flag.
//
// The Beam Spam tracker (er-achievement-tracker.ts) invalidates the achievement
// on any player move WITHOUT MoveFlags.PULSE_MOVE; Mega Launcher's MovePowerBoost
// attr boosts moves WITH MoveFlags.PULSE_MOVE. So a move that is "Mega Launcher
// boosted" in-game but lacks the flag would be boosted yet NOT counted (the live
// 'Beam Spam didn't unlock after a Rocket Shot + Mountain Chunk E4 win' report).
// #453 derives PULSE_MOVE straight from the dex "mega launcher boost" text (no
// hardcoded pulse list, covering ER customs), which keeps the two predicates in
// lock-step. This pins the two reported moves so a data/id-map regression can't
// silently unflag them again. Gated ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ErMoveId } from "#enums/er-move-id";
import { MoveFlags } from "#enums/move-flags";
import { describe, expect, it } from "vitest";

describe("Beam Spam / Mega Launcher shared PULSE_MOVE predicate (#453 / item 9)", () => {
  it.each([
    ["Mountain Chunk", ErMoveId.MOUNTAIN_CHUNK],
    ["Rocket Shot", ErMoveId.ROCKET_PUNCH],
  ])("%s is dex-tagged 'Mega Launcher boost' and carries PULSE_MOVE", (_name, moveId) => {
    const move = allMoves[moveId];
    expect(move).toBeDefined();
    expect(move?.hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
  });
});

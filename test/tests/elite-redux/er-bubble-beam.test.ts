/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER reworks Bubble Beam from vanilla's 65-power single hit with a 10% Speed
// drop into a 25-power Water pulse that strikes 2–5 times (Mega Launcher
// boosted). A stale c-source correction had pinned it at 65 power and kept the
// Speed-drop, so it played exactly like vanilla.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Bubble Beam = 25-power 2–5x Water pulse", () => {
  it("is 25 power with a 2–5 multi-hit and no Speed-drop secondary", () => {
    const m = allMoves[MoveId.BUBBLE_BEAM];
    expect(m.power).toBe(25);
    const attrNames = m.attrs.map(a => a.constructor.name);
    expect(attrNames).toContain("MultiHitAttr");
    // The vanilla 10% Speed-drop secondary must be gone.
    expect(attrNames).not.toContain("StatStageChangeAttr");
  });

  it("carries the PULSE_MOVE flag (Mega Launcher boost) and ER description", () => {
    const m = allMoves[MoveId.BUBBLE_BEAM];
    expect(m.hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
    expect(m.effect.toLowerCase()).toContain("2-5");
  });
});

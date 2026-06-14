/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// In ER, First Impression (#623) shares the Fake Out effect (effect 139): a
// guaranteed flinch, usable only on the first turn. Vanilla First Impression
// never flinched, so the port (which used the vanilla definition) didn't
// either. This pins the FlinchAttr alongside the first-turn condition.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER First Impression flinches like Fake Out", () => {
  it("carries FlinchAttr (the ER Fake Out effect)", () => {
    const m = allMoves[MoveId.FIRST_IMPRESSION];
    const attrNames = m.attrs.map(a => a.constructor.name);
    expect(attrNames).toContain("FlinchAttr");
  });

  it("has a 100% effect chance so the flinch always lands", () => {
    // ER dex effectChance is 100 (same as Fake Out). A stale c-source
    // correction had pinned chance to 0, which made FlinchAttr never fire.
    const m = allMoves[MoveId.FIRST_IMPRESSION];
    expect(m.chance).toBe(100);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#342): "Berry Smash" (ER move id 830) — "Deals damage. User eats
// their berry." — never consumed a berry. The auto-classifier only tagged it
// HAMMER_BASED (a flag-tagged-move) and missed the berry-eat clause, so no
// EatBerryAttr was ever attached. The per-id correction in
// init-elite-redux-custom-moves.ts now adds EatBerryAttr(selfTarget=true),
// mirroring Concoction (id 1022). EatBerryAttr already picks a RANDOM held berry
// when the user holds several (the user's "multiple berries" case), so no extra
// logic is needed for that.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Berry Smash makes the user eat one of its berries (#342)", () => {
  it("the built move carries EatBerryAttr (self-target)", () => {
    const move = allMoves[ER_ID_MAP.moves[830]];
    expect(move).toBeDefined();
    const eatBerry = move.attrs.find(a => a.constructor.name === "EatBerryAttr");
    expect(eatBerry, "Berry Smash must carry EatBerryAttr").toBeDefined();
    // selfTarget = the USER eats its OWN berry (not the target's).
    expect((eatBerry as { selfTarget?: boolean }).selfTarget).toBe(true);
  });
});

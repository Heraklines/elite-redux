/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The pokédex candy menu showed STALE (too-high) passive-unlock costs because it
// used the old `baseCost × [1,2,4]` multiplicative scheme while starter-select had
// moved to the #226 rework (halved baseline + flat +10/slot). Both now call the
// shared getErPassiveSlotCandyCost, so they can't diverge. This pins the formula.

import { getErPassiveSlotCandyCost } from "#balance/starters";
import { describe, expect, it } from "vitest";

describe("ER passive-slot candy cost (#226 shared formula)", () => {
  it("is ceil(base/2) + slot*10 (halved baseline + flat +10 per slot)", () => {
    const base = 30;
    expect(getErPassiveSlotCandyCost(base, 0)).toBe(15);
    expect(getErPassiveSlotCandyCost(base, 1)).toBe(25);
    expect(getErPassiveSlotCandyCost(base, 2)).toBe(35);
  });

  it("rounds the halved baseline up for odd base costs", () => {
    expect(getErPassiveSlotCandyCost(25, 0)).toBe(13); // ceil(12.5)
    expect(getErPassiveSlotCandyCost(25, 2)).toBe(33); // 13 + 20
  });

  it("is NOT the old multiplicative base×[1,2,4] scheme (the stale pokédex bug)", () => {
    const base = 30;
    // Old scheme would have produced 30 / 60 / 120 for slots 0/1/2.
    expect(getErPassiveSlotCandyCost(base, 1)).not.toBe(60);
    expect(getErPassiveSlotCandyCost(base, 2)).not.toBe(120);
  });
});

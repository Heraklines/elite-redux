/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#colosseum-overlevel) - the ER Colosseum / World Tournament vanilla
// (Ace/Youngster) round must not field trainers ~20 levels over the player's cap.
//
// The trainer brings its own team on the vanilla path, so the round nudges the level
// via the ME framework's `levelAdditiveModifier` (formula: level += round(waveIndex/10
// * modifier)). A FIXED modifier of 2 was "+2 levels" at wave 20 but +24 at wave 118 -
// the "tournament trainers were nearly 20 levels higher than me despite the L104 cap"
// report (capture 2026-07-05T19-09-08). The modifier is now scaled by 1/wave so the
// bump is a FLAT couple of levels at ANY wave.
// =============================================================================

import { colosseumVanillaLevelModifier } from "#data/mystery-encounters/encounters/colosseum-gauntlet";
import { describe, expect, it } from "vitest";

/** Mirrors initBattleWithEnemyConfig: additive = round(waveIndex / 10 * modifier). */
const additiveFor = (wave: number): number =>
  Math.max(Math.round((wave / 10) * colosseumVanillaLevelModifier(wave)), 0);

describe("ER Colosseum - vanilla round level nudge stays flat across waves (#colosseum-overlevel)", () => {
  it("adds a flat couple of levels at ANY wave (never ballooning at high waves)", () => {
    // At the reported wave 118 the OLD fixed modifier:2 added +24; the fix keeps it at +2.
    for (const wave of [10, 20, 60, 100, 118, 160, 199]) {
      expect(additiveFor(wave), `wave ${wave} level bump`).toBe(2);
    }
  });

  it("the reported wave-118 case is a +2 bump, not the old +24", () => {
    expect(additiveFor(118)).toBe(2);
    // Sanity: the OLD behavior (fixed modifier 2) would have been the reported ~+24.
    const oldAdditive = Math.round((118 / 10) * 2);
    expect(oldAdditive).toBeGreaterThanOrEqual(20);
  });
});

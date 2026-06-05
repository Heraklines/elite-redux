/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER custom moves must respect ER's contact data. PokeRogue's Move constructor
// flags EVERY physical move as MAKES_CONTACT by default (vanilla non-contact
// moves clear it with `.makesContact(false)`); ER custom moves never cleared it,
// so all 132 custom physical moves were wrongly contact — triggering contact
// abilities (Static, Rough Skin) and taking contact damage reduction (Fluffy,
// e.g. "Primal Beam did only 25%"). The builder now forces MAKES_CONTACT to
// match the ER flag list ("Makes Contact").
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER custom-move contact flag matches ER data", () => {
  it("Primal Beam (a beam) is NOT contact", () => {
    const primalBeam = allMoves[ER_ID_MAP.moves[769]]; // ER move id 769
    expect(primalBeam).toBeDefined();
    expect(primalBeam.category).toBe(MoveCategory.PHYSICAL);
    expect(primalBeam.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
  });

  it("custom physical moves are no longer ALL contact (the default-contact bug is gone)", () => {
    let physical = 0;
    let contact = 0;
    for (const pk of Object.values(ER_ID_MAP.moves)) {
      const move = allMoves[pk as number];
      if (!move || (pk as number) < 5000 || move.category !== MoveCategory.PHYSICAL) {
        continue;
      }
      physical++;
      if (move.hasFlag(MoveFlags.MAKES_CONTACT)) {
        contact++;
      }
    }
    expect(physical).toBeGreaterThan(0);
    // Before the fix this was 100% contact; a healthy chunk must now be non-contact.
    expect(contact).toBeLessThan(physical);
    expect(physical - contact).toBeGreaterThan(20);
  });
});

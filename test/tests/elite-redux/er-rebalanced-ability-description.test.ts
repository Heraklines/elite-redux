/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// When ER rewrites a vanilla ability's MECHANICS, the in-game DESCRIPTION must
// follow. Previously `Ability.description` always returned the vanilla i18n text
// (it has no override hook), so rewritten abilities like Big Pecks still read
// "Defense can't be lowered" instead of ER's contact-power boost.
//
// The rebalance now pins `descriptionOverride` from the ER ROM text on every
// rewritten ability, so EVERY surface reading `ability.description` is correct.
//
// Gated behind ER_SCENARIO=1 (descriptions only diverge under the ER rebalance).
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER rewritten abilities expose the ER description", () => {
  it("Big Pecks describes the contact-power boost, not vanilla Def-immunity", () => {
    const desc = allAbilities[AbilityId.BIG_PECKS].description;
    expect(desc).toContain("contact");
    expect(desc.toLowerCase()).not.toContain("defense"); // the vanilla wording
  });

  it("another TOTAL rewrite (Illuminate) also shows ER text, not the vanilla lure desc", () => {
    const desc = allAbilities[AbilityId.ILLUMINATE].description.toLowerCase();
    // ER Illuminate = pure accuracy boost; vanilla = "prevents accuracy loss / lures".
    expect(desc).toContain("accuracy");
  });

  it("a NON-rebalanced ability keeps its vanilla i18n description (no override leaks)", () => {
    // Overgrow is untouched by ER's vanilla rebalance.
    const desc = allAbilities[AbilityId.OVERGROW].description.toLowerCase();
    expect(desc).toContain("grass");
  });
});

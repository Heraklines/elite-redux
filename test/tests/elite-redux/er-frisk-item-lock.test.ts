/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Frisk / Supersweet Syrup item lock: the ER_ITEM_DISABLED tag locks only the
// holder's FIRST item (mons hold many here, so locking all would be too strong),
// matching the user's "only disable the first item" requirement. This pins the
// scoping logic (suppresses only the locked type id, not every item).
// =============================================================================

import { ErItemDisabledTag } from "#data/battler-tags";
import { describe, expect, it } from "vitest";

describe("ER item lock (ErItemDisabledTag) scope", () => {
  it("suppresses ONLY the locked item type id, not every held item", () => {
    const tag = new ErItemDisabledTag(2);
    tag.suppressedTypeIds = ["LEFTOVERS"];
    expect(tag.suppresses("LEFTOVERS")).toBe(true);
    expect(tag.suppresses("CHOICE_BAND")).toBe(false);
    expect(tag.suppresses("SITRUS_BERRY")).toBe(false);
  });

  it("never suppresses an empty/undefined type id", () => {
    const tag = new ErItemDisabledTag(2);
    tag.suppressedTypeIds = ["LEFTOVERS"];
    expect(tag.suppresses(undefined)).toBe(false);
    expect(tag.suppresses("")).toBe(false);
  });

  it("an empty lock list falls back to legacy 'all items' (older saves)", () => {
    const tag = new ErItemDisabledTag(2);
    expect(tag.suppressedTypeIds).toEqual([]);
    expect(tag.suppresses("ANY_ITEM")).toBe(true);
  });
});

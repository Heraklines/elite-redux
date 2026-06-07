/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER reworks COLOR_CHANGE: vanilla swaps the holder's type to the move's type
// AFTER the hit (PostDefendTypeChangeAbAttr). ER instead changes the holder to a
// type that resists/negates the move BEFORE it lands (PreHitResistTypeChangeAbAttr,
// applied from move-effect-phase before effectiveness). The vanilla-rebalance
// patcher must swap the attr; this asserts the post-init attr layout.

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

describe("ER Color Change is a PRE-hit resist type change", () => {
  const attrNames = (): string[] =>
    (allAbilities[AbilityId.COLOR_CHANGE] as unknown as { attrs: { constructor: { name: string } }[] }).attrs.map(
      a => a.constructor.name,
    );

  it("has the pre-hit resist attr", () => {
    expect(attrNames()).toContain("PreHitResistTypeChangeAbAttr");
  });

  it("no longer has the vanilla post-hit type-change attr", () => {
    expect(attrNames()).not.toContain("PostDefendTypeChangeAbAttr");
  });
});

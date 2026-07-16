/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// When ER rewrites a vanilla move's MECHANICS, the in-game description must
// follow. `localize()` runs at init (before the patch loop), so setting only
// `descriptionOverride` left the live `effect` text stale. The move-patch loop
// now pins the ER description (longDescription) on every patched move — setting
// BOTH `descriptionOverride` (survives re-localize) and `effect` (live UI text).
// Bespoke overrides (the Pledge moves) are never clobbered.
//
// Repro: Dragon Rush gained 33% recoil + 20% flinch (95/95) but read like
// vanilla "may also make the target flinch".
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER patched-move descriptions follow the rewritten mechanics", () => {
  it("Dragon Rush: ER stats + mechanics ARE implemented", () => {
    const m = allMoves[MoveId.DRAGON_RUSH];
    // ER 2.65 dex authority (Section A numeric-conflict ruling): power 120 /
    // accuracy 100. The prior 95/95 was a stale C-source override the maintainer
    // overruled in favour of `er-moves.ts` (id 407).
    expect(m.power).toBe(120);
    expect(m.accuracy).toBe(100);
    const attrNames = m.attrs.map(a => a.constructor.name);
    expect(attrNames).toContain("FlinchAttr"); // 20% flinch
    expect(attrNames).toContain("RecoilAttr"); // 33% recoil
  });

  it("Dragon Rush: description mentions the ER recoil + flinch, not just vanilla flinch", () => {
    const m = allMoves[MoveId.DRAGON_RUSH];
    const text = m.effect.toLowerCase();
    expect(text).toContain("recoil");
    expect(text).toContain("flinch");
    expect((m as unknown as { descriptionOverride?: string }).descriptionOverride).toContain("recoil");
  });

  it("does not clobber a bespoke override (Grass Pledge keeps its ER Pledge text)", () => {
    const pledge = allMoves[MoveId.GRASS_PLEDGE];
    // The Pledge patcher sets its own override; the systemic pass must skip it.
    expect((pledge as unknown as { descriptionOverride?: string }).descriptionOverride).toBeDefined();
    expect(pledge.effect.length).toBeGreaterThan(0);
  });
});

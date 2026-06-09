/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#353/#354/#355) — user-reported ER move specs:
//  - Slash: 60 BP / 100% / 10 PP, ALWAYS crits, 20% bleed
//  - Cut:   60 BP / 100% / 20 PP, ALWAYS crits, 10% bleed
//  - Mud-Slap: 25 BP / 100% / 10 PP, hits 2-5 times, NO accuracy drop
//  - Hidden Power: 80 BP (was stale 70)
//  - Secret Power: 80 BP physical Hidden Power (type varies with the user)
//  - Techno Blast: Hidden Power mechanic at 120 BP / 5 PP (no Drive item)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const attrNames = (id: MoveId): string[] => allMoves[id].attrs.map(a => a.constructor.name);
const hasBleed = (id: MoveId): boolean =>
  allMoves[id].attrs.some(
    a =>
      a.constructor.name === "AddBattlerTagAttr"
      && (a as { tagType?: BattlerTagType }).tagType === BattlerTagType.ER_BLEED,
  );

describe.skipIf(!RUN)("ER move batch: Slash/Cut/Mud-Slap/HP/Secret Power/Techno Blast", () => {
  it("Slash: 60/100/10, crit-only, 20% bleed", () => {
    const m = allMoves[MoveId.SLASH];
    expect([m.power, m.accuracy, m.pp, m.chance]).toEqual([60, 100, 10, 20]);
    expect(attrNames(MoveId.SLASH)).toContain("CritOnlyAttr");
    expect(hasBleed(MoveId.SLASH)).toBe(true);
  });

  it("Cut: 60/100/20, crit-only, 10% bleed (stays Steel + field-based)", () => {
    const m = allMoves[MoveId.CUT];
    expect([m.power, m.accuracy, m.pp, m.chance]).toEqual([60, 100, 20, 10]);
    expect(attrNames(MoveId.CUT)).toContain("CritOnlyAttr");
    expect(hasBleed(MoveId.CUT)).toBe(true);
  });

  it("Mud-Slap: 25/100/10, multi-hit, NO accuracy drop", () => {
    const m = allMoves[MoveId.MUD_SLAP];
    expect([m.power, m.accuracy, m.pp]).toEqual([25, 100, 10]);
    expect(attrNames(MoveId.MUD_SLAP)).toContain("MultiHitAttr");
    expect(attrNames(MoveId.MUD_SLAP)).not.toContain("StatStageChangeAttr");
  });

  it("Hidden Power: 80 BP, keeps the type-varies attr", () => {
    const m = allMoves[MoveId.HIDDEN_POWER];
    expect(m.power).toBe(80);
    expect(attrNames(MoveId.HIDDEN_POWER)).toContain("HiddenPowerTypeAttr");
  });

  it("Secret Power: 80 BP PHYSICAL Hidden Power (terrain secondary removed)", () => {
    const m = allMoves[MoveId.SECRET_POWER];
    expect(m.power).toBe(80);
    expect(m.category).toBe(MoveCategory.PHYSICAL);
    expect(attrNames(MoveId.SECRET_POWER)).toContain("HiddenPowerTypeAttr");
    expect(attrNames(MoveId.SECRET_POWER)).not.toContain("SecretPowerAttr");
  });

  it("Techno Blast: 120 BP / 5 PP Hidden Power mechanic (Drive attr removed)", () => {
    const m = allMoves[MoveId.TECHNO_BLAST];
    expect([m.power, m.pp]).toEqual([120, 5]);
    expect(attrNames(MoveId.TECHNO_BLAST)).toContain("HiddenPowerTypeAttr");
    expect(attrNames(MoveId.TECHNO_BLAST)).not.toContain("TechnoBlastTypeAttr");
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Recreated ER-only held items: Life Orb (×1.3 dmg), Assault Vest (SpDef ×1.5,
// SpDef-only), Rocky Helmet (presence marker; contact damage applied in-phase).
import {
  ER_ASSAULT_VEST_TYPE,
  ER_LIFE_ORB_TYPE,
  ER_ROCKY_HELMET_TYPE,
  ErAssaultVestModifier,
  ErLifeOrbModifier,
  ErRockyHelmetModifier,
} from "#data/elite-redux/er-recreated-items";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

describe("ER recreated held items", () => {
  it("Life Orb boosts outgoing damage by 1.3×", () => {
    const orb = new ErLifeOrbModifier(ER_LIFE_ORB_TYPE(), 1);
    const dmg = { value: 100 };
    orb.apply({} as any, dmg as any);
    expect(dmg.value).toBe(130);
    expect(orb.getMaxHeldItemCount()).toBe(1);
  });

  it("Assault Vest multiplies Sp. Def by 1.5 and ONLY Sp. Def", () => {
    const av = new ErAssaultVestModifier(ER_ASSAULT_VEST_TYPE(), 1);
    const holder = { id: 1, getTag: () => undefined } as any;
    // Sp. Def is boosted…
    expect(av.shouldApply(holder, Stat.SPDEF, { value: 100 } as any)).toBe(true);
    const sd = { value: 100 };
    av.apply(holder, Stat.SPDEF, sd as any);
    expect(sd.value).toBe(150);
    // …other stats are not.
    expect(av.shouldApply(holder, Stat.ATK, { value: 100 } as any)).toBe(false);
    expect(av.shouldApply(holder, Stat.SPD, { value: 100 } as any)).toBe(false);
  });

  it("Assault Vest only applies to its own holder", () => {
    const av = new ErAssaultVestModifier(ER_ASSAULT_VEST_TYPE(), 5);
    expect(av.shouldApply({ id: 5, getTag: () => undefined } as any, Stat.SPDEF, { value: 1 } as any)).toBe(true);
    expect(av.shouldApply({ id: 6, getTag: () => undefined } as any, Stat.SPDEF, { value: 1 } as any)).toBe(false);
  });

  it("Rocky Helmet builds and matches its own type", () => {
    const helmet = new ErRockyHelmetModifier(ER_ROCKY_HELMET_TYPE(), 1);
    expect(helmet.getMaxHeldItemCount()).toBe(1);
    expect(helmet.matchType(new ErRockyHelmetModifier(ER_ROCKY_HELMET_TYPE(), 1))).toBe(true);
    expect(helmet.matchType(new ErLifeOrbModifier(ER_LIFE_ORB_TYPE(), 1))).toBe(false);
  });
});

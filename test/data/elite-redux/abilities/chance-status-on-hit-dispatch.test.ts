/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D round 2: dispatcher routing for `chance-status-on-hit`
// rows whose status string is a BattlerTag concept (CONFUSION, INFATUATION,
// FLINCH, DISABLE) rather than a vanilla StatusEffect.
//
// Pre-round-2, the dispatcher hard-skipped these — they're now routed to
// the new `ChanceBattlerTagOnHitAbAttr` archetype primitive. This file
// verifies the routing decisions for the ER ids the inventory wires through
// the tag flavor.
// =============================================================================

import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import {
  ChanceBattlerTagOnHitAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

describe("dispatchArchetype('chance-status-on-hit'): BattlerTag routing", () => {
  it("CONFUSION → ChanceBattlerTagOnHitAbAttr with CONFUSED", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 50,
      status: "CONFUSION",
      onContactOnly: false,
    });
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(attr.getChance()).toBe(50);
    expect(attr.getTags()).toEqual([BattlerTagType.CONFUSED]);
    expect(attr.requiresContact()).toBe(false);
  });

  it("INFATUATION → ChanceBattlerTagOnHitAbAttr with INFATUATED", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "INFATUATION",
      onContactOnly: false,
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.INFATUATED]);
  });

  it("FLINCH → ChanceBattlerTagOnHitAbAttr with FLINCHED", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 20,
      status: "FLINCH",
      onContactOnly: false,
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.FLINCHED]);
  });

  it("DISABLE → ChanceBattlerTagOnHitAbAttr with DISABLED", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 20,
      status: "DISABLE",
      // No onContactOnly — should default to contactRequired=true.
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.DISABLED]);
  });

  it("vanilla StatusEffect path still routes to ChanceStatusOnHitAbAttr (BURN)", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "BURN",
      onContactOnly: true,
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceStatusOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceStatusOnHitAbAttr);
    expect(attr.getEffects()).toEqual([StatusEffect.BURN]);
  });

  it("ER-specific BLEED still skips (not in StatusEffect or BattlerTag vocabularies)", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "BLEED",
    });
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/not a vanilla StatusEffect or BattlerTag/);
  });

  it("ER-specific FROSTBITE still skips", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "FROSTBITE",
    });
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/not a vanilla StatusEffect or BattlerTag/);
  });

  it("ER-specific FEAR still skips", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "FEAR",
    });
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/not a vanilla StatusEffect or BattlerTag/);
  });
});

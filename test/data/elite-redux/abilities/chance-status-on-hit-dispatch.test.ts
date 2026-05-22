/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D rounds 2/5: dispatcher routing for `chance-status-on-hit`
// rows whose status string is a BattlerTag concept (CONFUSION, INFATUATION,
// FLINCH, DISABLE) — and round 5 extension: ER-specific BLEED/FROSTBITE/FEAR
// statuses are now backed by `ER_BLEED`/`ER_FROSTBITE`/`ER_FEAR` battler tags
// and route through the same `ChanceBattlerTagOnHitAbAttr` path, plus the
// new optional `filter` (move-flag / type) support on both flavors.
// =============================================================================

import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import {
  ChanceBattlerTagOnHitAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
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

  it("ER-specific BLEED routes through ER_BLEED battler tag", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "BLEED",
      onContactOnly: true,
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceBattlerTagOnHitAbAttr);
    expect(attr.getTags()).toEqual([BattlerTagType.ER_BLEED]);
    expect(attr.requiresContact()).toBe(true);
  });

  it("ER-specific FROSTBITE routes through ER_FROSTBITE battler tag", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "FROSTBITE",
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.ER_FROSTBITE]);
  });

  it("ER-specific FEAR routes through ER_FEAR battler tag", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 10,
      status: "FEAR",
      onContactOnly: false,
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.ER_FEAR]);
    expect(attr.requiresContact()).toBe(false);
  });
});

describe("dispatchArchetype('chance-status-on-hit'): filter routing", () => {
  it("flag-filter (SOUND_BASED + DISABLE) carries through to BattlerTag attr", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 20,
      status: "DISABLE",
      filter: { flag: "SOUND_BASED" },
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.DISABLED]);
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.SOUND_BASED });
    // Filter present + no onContactOnly → contact gate disabled.
    expect(attr.requiresContact()).toBe(false);
  });

  it("flag-filter (BITING_MOVE + FROSTBITE) routes to ER_FROSTBITE with filter", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 50,
      status: "FROSTBITE",
      filter: { flag: "STRONG_JAW" },
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.ER_FROSTBITE]);
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.BITING_MOVE });
  });

  it("flag-filter (SLICING_MOVE + BLEED) routes to ER_BLEED with filter", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 50,
      status: "BLEED",
      filter: { flag: "KEEN_EDGE" },
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceBattlerTagOnHitAbAttr;
    expect(attr.getTags()).toEqual([BattlerTagType.ER_BLEED]);
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.SLICING_MOVE });
  });

  it("type-filter (GRASS + BURN) carries through to StatusEffect attr", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "BURN",
      filter: { type: "GRASS" },
    });
    expect(res.skipReason).toBeNull();
    const attr = res.attrs[0] as ChanceStatusOnHitAbAttr;
    expect(attr).toBeInstanceOf(ChanceStatusOnHitAbAttr);
    expect(attr.getEffects()).toEqual([StatusEffect.BURN]);
    expect(attr.getFilter()).toEqual({ type: PokemonType.GRASS });
  });

  it("unparseable filter (malformed) records skip reason", () => {
    const res = dispatchArchetype("chance-status-on-hit", {
      chance: 30,
      status: "BURN",
      filter: { flag: "TOTALLY_BOGUS" },
    });
    expect(res.attrs).toHaveLength(0);
    expect(res.skipReason).toMatch(/unparseable filter/);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #120 — FULL expanded ability descriptions extracted directly from the
// v2.65.3b ROM binary (gAbilitiesInfo struct array; detailed-desc field) into
// er-ability-rom-descriptions.ts, surfaced via getErAbilityRomDescription() and
// shown on the ability "Detail" view. These are the long in-game texts (e.g.
// North Wind / Snow Warning), not the abbreviated one-liners.
//
// Pure data assertions — no GameManager.
// =============================================================================

import { getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { ER_ABILITY_ROM_DESCRIPTIONS } from "#data/elite-redux/er-ability-rom-descriptions";
import { describe, expect, it } from "vitest";

describe("ER ROM detailed ability descriptions (#120)", () => {
  it("extracted the full struct-array description set (~1000)", () => {
    expect(Object.keys(ER_ABILITY_ROM_DESCRIPTIONS).length).toBeGreaterThan(900);
  });

  it("returns the FULL detail text matching the in-game Detail view", () => {
    const northWind = getErAbilityRomDescription("North Wind");
    expect(northWind).toContain("Aurora Veil lasts 3 turns");
    expect(northWind).toContain("immune to Hail damage");
    expect((northWind ?? "").length).toBeGreaterThan(150); // long, not the one-liner

    const snow = getErAbilityRomDescription("Snow Warning");
    expect(snow).toContain("Icy Rock");
    expect(snow).toContain("non-Ice");
  });

  it("covers ER custom abilities including beta-only ones beyond the text source", () => {
    // Flammable Coat exists only in the ROM struct array (not abilities.h text).
    expect(getErAbilityRomDescription("Flammable Coat")).toContain("Lumbering Sloth");
    expect(getErAbilityRomDescription("Best Offense")).toContain("Special Defense");
    // Apostrophe handling: "Angel's Wrath" ↔ ABILITY_ANGELS_WRATH.
    expect(getErAbilityRomDescription("Angel's Wrath")).toBeTruthy();
  });

  it("returns null for an unknown ability name", () => {
    expect(getErAbilityRomDescription("Definitely Not An Ability")).toBeNull();
    expect(getErAbilityRomDescription("")).toBeNull();
  });
});

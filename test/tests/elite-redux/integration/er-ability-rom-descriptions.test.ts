/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #120 — full in-game ability descriptions extracted from the v2.65.3b ROM
// (src/data/text/abilities.h) into er-ability-rom-descriptions.ts, surfaced via
// getErAbilityRomDescription() and shown on the ability "Detail" view.
//
// Pure data assertions — no GameManager.
// =============================================================================

import { getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { ER_ABILITY_ROM_DESCRIPTIONS } from "#data/elite-redux/er-ability-rom-descriptions";
import { describe, expect, it } from "vitest";

describe("ER ROM ability descriptions (#120)", () => {
  it("extracted the full v2.65.3b ROM description set (~447)", () => {
    expect(Object.keys(ER_ABILITY_ROM_DESCRIPTIONS).length).toBeGreaterThan(440);
  });

  it("returns the ROM text (with line breaks) for rebalanced vanilla abilities", () => {
    // ER's Battle Armor is rebalanced (blocks crits + 20% less damage).
    expect(getErAbilityRomDescription("Battle Armor")).toBe("Blocks critical hits.\nTakes 20% less damage.");
    expect(getErAbilityRomDescription("Stench")).toContain("flinch");
  });

  it("resolves ER custom abilities present in the ROM (through Furnace)", () => {
    expect(getErAbilityRomDescription("Furnace")).toBeTruthy();
    // Apostrophe handling: "Angel's Wrath" ↔ ABILITY_ANGELS_WRATH.
    expect(getErAbilityRomDescription("Angel's Wrath")).toBeTruthy();
  });

  it("returns null for beta-only abilities beyond the v2.65.3b ROM", () => {
    // Flammable Coat / Best Offense exist only in the beta JSON, not the ROM.
    expect(getErAbilityRomDescription("Flammable Coat")).toBeNull();
    expect(getErAbilityRomDescription("")).toBeNull();
  });
});

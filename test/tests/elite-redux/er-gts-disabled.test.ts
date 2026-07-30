/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { initMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounters";
import { describe, expect, it } from "vitest";

describe("Global Trade System event disablement", () => {
  it("does not place GTS in any live biome encounter pool", () => {
    initMysteryEncounters();

    for (const [biome, encounters] of mysteryEncountersByBiome) {
      expect(encounters, `biome ${biome} must not spawn the disabled GTS event`).not.toContain(
        MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
      );
    }
  });
});

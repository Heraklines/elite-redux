/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The vanilla base Ogerpon hatches from EPIC eggs. Elite Redux also ships the
// mask forms (Wellspring / Hearthflame / Cornerstone) as separate custom
// species at BST 550 — which would otherwise band into RARE. They should all be
// EPIC, matching the base. This guards that no Ogerpon form that reaches the egg
// pool sits below EPIC.

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import { EggTier } from "#enums/egg-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Ogerpon forms are EPIC egg-tier", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("every egg-poolable Ogerpon form is EPIC (none RARE/below)", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const ogerpons = allSpecies.filter(s => s.name?.startsWith("Ogerpon"));
    expect(ogerpons.length).toBeGreaterThan(0);

    const poolable = ogerpons.filter(s => tiers[s.speciesId] !== undefined);
    // At least the base + the three masks should be hatchable.
    expect(poolable.length).toBeGreaterThan(0);
    for (const s of poolable) {
      console.log(`[ogerpon] ${s.name} (#${s.speciesId}) → tier ${EggTier[tiers[s.speciesId]!]}`);
      expect(tiers[s.speciesId]).toBe(EggTier.EPIC);
    }
  });

  it("every egg-poolable Thundurus / Silvally form is EPIC (none RARE/below)", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const fams = allSpecies.filter(s => /^(Thundurus|Silvally)/.test(s.name ?? ""));
    const poolable = fams.filter(s => tiers[s.speciesId] !== undefined);
    expect(poolable.length).toBeGreaterThan(0);
    for (const s of poolable) {
      console.log(`[legend-forms] ${s.name} (#${s.speciesId}) → tier ${EggTier[tiers[s.speciesId]!]}`);
      expect(tiers[s.speciesId]).toBe(EggTier.EPIC);
    }
  });
});

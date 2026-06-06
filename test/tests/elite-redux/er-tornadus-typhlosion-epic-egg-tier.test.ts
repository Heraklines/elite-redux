/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EPIC egg-tier overrides for two ER-custom legendary/regional forms that would
// otherwise band as RARE (BST 540-599):
//   - "Tornadus Therian" (pokedex No 0268 region; pkrg 10268) — pinned EPIC via
//     the "Tornadus" name-prefix override (parity with the EPIC vanilla base).
//   - "Lumbering Sloth Engulfed" (the Typhlosion custom, pokedex No 0439
//     regionalForm; pkrg 10439) — pinned EPIC via an exact-name override.

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import { EggTier } from "#enums/egg-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Tornadus Therian + Typhlosion custom are EPIC egg-tier", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Tornadus Therian resolves to EPIC", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const sp = allSpecies.find(s => s.name === "Tornadus Therian");
    expect(sp, "Tornadus Therian should be registered").toBeDefined();
    expect(tiers[sp!.speciesId], "Tornadus Therian must be in the egg pool").toBeDefined();
    expect(tiers[sp!.speciesId]).toBe(EggTier.EPIC);
  });

  it("the Typhlosion custom (Lumbering Sloth Engulfed) resolves to EPIC", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const sp = allSpecies.find(s => s.name === "Lumbering Sloth Engulfed");
    expect(sp, "Lumbering Sloth Engulfed should be registered").toBeDefined();
    expect(tiers[sp!.speciesId], "Lumbering Sloth Engulfed must be in the egg pool").toBeDefined();
    expect(tiers[sp!.speciesId]).toBe(EggTier.EPIC);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Egg-pool declutter (#407): the imported alternate-form duplicates (Unown
// letters, Arceus plates, Pikachu caps, ...) and battle-only forms are removed
// from BOTH the egg-hatch pool and starter select. Player progress on a
// removed form is compressed onto its vanilla base on save load (a red-shiny
// Unown letter unlocks red shiny on vanilla Unown) WITHOUT touching the
// source save data. Gated behind ER_SCENARIO=1.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import {
  applyErEggPoolBans,
  ER_REMOVED_EGG_FORMS,
  getErRemovedFormIdTargets,
  migrateErRemovedFormUnlocks,
} from "#data/elite-redux/er-egg-pool-bans";
import { getErEggWeightDivisor } from "#data/elite-redux/init-elite-redux-egg-tiers";
import { DexAttr } from "#enums/dex-attr";
import type { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const VANILLA_ID_CUTOFF = 10000;

describe.skipIf(!RUN)("ER egg-pool declutter bans (#407)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  const idByName = (name: string): number | undefined =>
    allSpecies.find(sp => sp.speciesId >= VANILLA_ID_CUTOFF && sp.name === name)?.speciesId;

  it("every banned name resolves to a live ER species and is OUT of eggs + starter select", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const costs = speciesStarterCosts as Record<number, number | undefined>;
    const targets = getErRemovedFormIdTargets();
    // The full list resolves (no stale display names)...
    expect(targets.size).toBe(ER_REMOVED_EGG_FORMS.length);
    // ...and none of them remain registered anywhere.
    for (const id of targets.keys()) {
      expect(tiers[id], `egg tier for banned id ${id}`).toBeUndefined();
      expect(costs[id], `starter cost for banned id ${id}`).toBeUndefined();
    }
    // Re-running the ban pass is a harmless no-op (idempotent).
    expect(applyErEggPoolBans()).toBe(0);
  });

  it("the maintainer keep-list is still hatchable: Kalos fusion trio, Grotom, Mimikyu Apex, Wooly Worm", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    for (const name of [
      "Ash-Greninja",
      "Clemont-Chesnaught",
      "Serena-Delphox",
      "Grotom",
      "Mimikyu Apex",
      "Wooly Worm",
    ]) {
      const id = idByName(name);
      expect(id, `${name} registered`).toBeDefined();
      expect(tiers[id!], `${name} egg tier`).toBeDefined();
    }
    // The one true Unown: every ER Unown (Revelation included) is gone.
    for (const sp of allSpecies) {
      if (sp.speciesId >= VANILLA_ID_CUTOFF && /^Unown\b/.test(sp.name)) {
        expect(tiers[sp.speciesId], `${sp.name} must not hatch`).toBeUndefined();
      }
    }
    expect(tiers[SpeciesId.UNOWN], "vanilla Unown stays hatchable").toBeDefined();
  });

  it("the Grotom appliance variants are down-weighted as ONE family (divisor 6)", () => {
    const grotomIds = allSpecies
      .filter(sp => sp.speciesId >= VANILLA_ID_CUTOFF && /^Grotom\b/.test(sp.name))
      .map(sp => sp.speciesId);
    expect(grotomIds.length).toBe(6);
    for (const id of grotomIds) {
      expect(getErEggWeightDivisor(id)).toBe(6);
    }
  });

  it("a red-shiny removed form compresses onto its vanilla base on load, idempotently, without wiping the source", () => {
    const gameData = game.scene.gameData;
    const unownB = idByName("Unown B")!;
    expect(unownB).toBeDefined();

    // Player owns a red (VARIANT_3) shiny Unown B with candies + black shiny.
    const source = gameData.dexData[unownB];
    source.caughtAttr = DexAttr.SHINY | DexAttr.VARIANT_3 | DexAttr.MALE | DexAttr.DEFAULT_FORM;
    source.seenAttr = source.caughtAttr;
    gameData.starterData[unownB] = {
      ...gameData.starterData[SpeciesId.UNOWN],
      candyCount: 7,
      friendship: 50,
      erBlackShiny: true,
    };
    const dest = gameData.dexData[SpeciesId.UNOWN];
    dest.caughtAttr = 0n;
    dest.seenAttr = 0n;
    gameData.starterData[SpeciesId.UNOWN].candyCount = 3;
    gameData.starterData[SpeciesId.UNOWN].erBlackShiny = false;

    migrateErRemovedFormUnlocks(gameData);

    // The vanilla base absorbed the red shiny + black shiny + candies...
    expect(dest.caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    expect(dest.caughtAttr & DexAttr.VARIANT_3).toBe(DexAttr.VARIANT_3);
    expect(gameData.starterData[SpeciesId.UNOWN].erBlackShiny).toBe(true);
    expect(gameData.starterData[SpeciesId.UNOWN].candyCount).toBe(10);
    // ...the SOURCE save data is untouched (nothing deleted)...
    expect(source.caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    // ...and a second load does NOT double the candies (flag-guarded).
    migrateErRemovedFormUnlocks(gameData);
    expect(gameData.starterData[SpeciesId.UNOWN].candyCount).toBe(10);
  });
});

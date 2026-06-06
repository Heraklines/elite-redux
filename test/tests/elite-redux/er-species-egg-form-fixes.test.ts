/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Guards three ER species/egg/form fixes:
//   (a) "Wooly Worm" (pkrg 10067) resolves to EggTier.EPIC.
//   (b) Darmanitan Redux Bond (10813) and Blunder (10818) are excluded from BOTH
//       egg hatches (speciesEggTiers) and starter selection (speciesStarterCosts).
//   (c) Moltres EX (pkrg 10622) has a SpeciesFormChange triggered by the
//       Moltresite item to its "mega" form (pkrg 10619 / SpeciesFormKey.MEGA).

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { EggTier } from "#enums/egg-type";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const WOOLY_WORM = 10067;
const DARMANITAN_REDUX_BOND = 10813;
const DARMANITAN_REDUX_BLUNDER = 10818;
const MOLTRES_EX = 10622;

describe("ER species/egg/form fixes", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("(a) Wooly Worm is EPIC egg tier", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    console.log(`[wooly] tier = ${tiers[WOOLY_WORM] === undefined ? "undefined" : EggTier[tiers[WOOLY_WORM]!]}`);
    expect(tiers[WOOLY_WORM]).toBe(EggTier.EPIC);
  });

  it("(b) Darmanitan Redux Bond/Blunder are excluded from egg hatches AND starter selection", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const costs = speciesStarterCosts as Record<number, number | undefined>;
    for (const id of [DARMANITAN_REDUX_BOND, DARMANITAN_REDUX_BLUNDER]) {
      console.log(`[darmanitan] #${id}: eggTier=${tiers[id]}, starterCost=${costs[id]}`);
      expect(tiers[id]).toBeUndefined();
      expect(costs[id]).toBeUndefined();
    }
    // Diagnostic: the other ER Battle-Bond forms (also battle-only) are likewise
    // excluded by the shared BOND-token guard. Logged for visibility, not asserted.
    for (const id of [10279, 10451, 10453]) {
      console.log(`[battle-bond] #${id}: eggTier=${tiers[id]}, starterCost=${costs[id]}`);
    }
  });

  it("(crash regression) every species in the egg pool resolves to a registered species", () => {
    // Repro for the EggLapsePhase freeze: a degenerate stub / id-map-drift draft
    // could leave a dangling id in speciesEggTiers, and egg.ts:rollSpecies would
    // deref getPokemonSpecies(id).hasVariants() -> undefined -> hard crash.
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const dangling = Object.keys(tiers)
      .map(k => Number(k))
      .filter(id => tiers[id] !== undefined && !getPokemonSpecies(id as SpeciesId));
    if (dangling.length > 0) {
      console.log(`[dangling egg ids] ${dangling.join(", ")}`);
    }
    expect(dangling).toEqual([]);
  });

  it("(c) Moltres EX has a Moltresite-triggered mega form change to formKey 'mega'", () => {
    const changes = pokemonFormChanges[MOLTRES_EX] ?? [];
    console.log(`[moltres] form changes: ${changes.map(c => `${c.preFormKey || "<base>"}->${c.formKey}`).join(", ")}`);
    const megaChange = changes.find(c => c.formKey === SpeciesFormKey.MEGA && c.preFormKey === "");
    expect(megaChange).toBeDefined();
    const trigger = megaChange!.trigger;
    expect(trigger).toBeInstanceOf(SpeciesFormChangeItemTrigger);
    expect((trigger as SpeciesFormChangeItemTrigger).item).toBe(FormChangeItem.MOLTRESITE);
  });
});

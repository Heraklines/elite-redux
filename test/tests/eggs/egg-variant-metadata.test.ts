/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { Egg } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { VariantTier } from "#enums/variant-tier";
import { clearVariantData, variantData } from "#sprites/variant";
import { EggData } from "#system/egg-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Egg shiny tiers during sprite metadata reloads", () => {
  let game: GameManager;
  let originalVariants: Record<string, unknown>;
  let originalExperimentalSprites: boolean;

  beforeAll(() => {
    game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
    originalVariants = { ...variantData };
    originalExperimentalSprites = game.scene.experimentalSprites;
  });

  afterEach(() => {
    clearVariantData();
    Object.assign(variantData, originalVariants);
    game.scene.experimentalSprites = originalExperimentalSprites;
  });

  it("keeps the same 1,500 candy-egg rolls when sprite metadata is absent", () => {
    const startingCounters = { ...game.scene.gameData.sameSpeciesEggCounters };
    const roll = () =>
      Array.from({ length: 1500 }, () => {
        const egg = new Egg({ species: SpeciesId.BULBASAUR, sourceType: EggSourceType.SAME_SPECIES_EGG });
        return { shiny: egg.isShiny, tier: egg.variantTier };
      });
    const loaded = roll();
    expect(loaded.some(egg => egg.shiny && egg.tier === VariantTier.RARE)).toBe(true);
    expect(loaded.some(egg => egg.shiny && egg.tier === VariantTier.EPIC)).toBe(true);

    game.scene.gameData.sameSpeciesEggCounters = { ...startingCounters };
    clearVariantData();
    expect(roll()).toEqual(loaded);
  });

  it.each([
    VariantTier.STANDARD,
    VariantTier.RARE,
    VariantTier.EPIC,
  ])("preserves saved tier %i through JSON restoration and hatching without metadata", tier => {
    const original = new Egg({
      id: 123456789,
      species: SpeciesId.BULBASAUR,
      sourceType: EggSourceType.SAME_SPECIES_EGG,
      isShiny: true,
      variantTier: tier,
    });
    const saved = JSON.parse(JSON.stringify(new EggData(original)));
    clearVariantData();
    const restored = new EggData(saved).toEgg();
    expect(restored.variantTier).toBe(tier);
    expect(restored.isShiny).toBe(true);
    const hatched = restored.generatePlayerPokemon();
    expect(hatched.shiny).toBe(true);
    expect(hatched.variant).toBe(tier);
  });

  it("keeps vanilla species in higher-tier gacha eggs without sprite metadata", () => {
    // Unlock pity narrows this tier to Bulbasaur, making the selected species
    // deterministic without mocking the pool or the variant eligibility check.
    for (const id of Object.keys(speciesEggTiers)) {
      game.scene.gameData.dexData[Number(id)].caughtAttr = 1n;
    }
    game.scene.gameData.unlockPity[EggTier.COMMON] = 9;
    game.scene.gameData.dexData[SpeciesId.BULBASAUR].caughtAttr = 0n;
    game.scene.gameData.eggs = [];
    clearVariantData();
    const egg = new Egg({
      tier: EggTier.COMMON,
      sourceType: EggSourceType.GACHA_MOVE,
      isShiny: true,
      variantTier: VariantTier.EPIC,
    });
    expect(egg.species).toBe(SpeciesId.BULBASAUR);
    expect(egg.variantTier).toBe(VariantTier.EPIC);
  });

  it("keeps the old registry until both standard and experimental metadata are ready", async () => {
    const old = { ...variantData };
    let resolveStandard!: (value: Response) => void;
    let resolveExperimental!: (value: Response) => void;
    const standard = new Promise<Response>(resolve => {
      resolveStandard = resolve;
    });
    const experimental = new Promise<Response>(resolve => {
      resolveExperimental = resolve;
    });
    const fetchMetadata = vi.fn((url: string) => (url.includes("_exp_masterlist") ? experimental : standard));
    game.scene.experimentalSprites = true;
    const reload = game.scene.initVariantData(fetchMetadata);
    expect(variantData).toEqual(old);
    resolveStandard({ json: async () => ({ "1": [0, 1, 1] }) } as Response);
    await vi.waitFor(() => expect(fetchMetadata).toHaveBeenCalledWith("./images/pokemon/variant/_exp_masterlist.json"));
    expect(variantData).toEqual(old);
    resolveExperimental({ json: async () => ({ "1": [0, 2, 2] }) } as Response);
    await reload;
    expect(variantData).toEqual({ "1": [0, 2, 2] });
  });

  it("retains working metadata if a reload fails", async () => {
    const old = { ...variantData };
    const fetchMetadata = vi.fn().mockRejectedValue(new Error("metadata offline"));
    await expect(game.scene.initVariantData(fetchMetadata)).rejects.toThrow("metadata offline");
    expect(variantData).toEqual(old);
  });
});

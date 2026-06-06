/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Bug (a): On a Pokédex page, the candy "Reduce Cost" menu must reflect the
// CURRENT value reduction. After buying one reduction the menu was reopened and
// still showed the original (pre-reduction) cost/new-cost. The displayed cost
// must update immediately (matching the starter-select candy menu).
//
// This drives the real PokedexPageUiHandler and captures the OPTION_SELECT
// payload it emits for the candy menu (Button.STATS), then invokes the
// reduce-cost option's handler and reopens the menu to assert the label moved
// to the next reduction tier.

import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import type { PokemonSpecies } from "#data/pokemon-species";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedOption {
  label: string;
  handler: () => boolean | Promise<boolean>;
  item?: string;
}

describe("ER pokedex candy Reduce-Cost menu freshness", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  async function runToPokedexPage(species: PokemonSpecies): Promise<PokedexPageUiHandler> {
    await game.runToTitle();
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, species, {});
    const handler = game.scene.ui.getHandler();
    expect(handler).toBeInstanceOf(PokedexPageUiHandler);
    return handler as PokedexPageUiHandler;
  }

  function lastCandyOptions(spy: ReturnType<typeof vi.spyOn>): CapturedOption[] {
    for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
      const call = spy.mock.calls[i];
      if (call[0] === UiMode.OPTION_SELECT) {
        const payload = call[1] as { options: CapturedOption[] } | undefined;
        if (payload && Array.isArray(payload.options)) {
          return payload.options;
        }
      }
    }
    throw new Error("No OPTION_SELECT candy payload captured");
  }

  /** Open the candy menu (Button.STATS) and return the emitted options. */
  function openCandyMenu(handler: PokedexPageUiHandler, spy: ReturnType<typeof vi.spyOn>): CapturedOption[] {
    handler.processInput(Button.STATS);
    return lastCandyOptions(spy);
  }

  function findReduceCost(options: CapturedOption[]): CapturedOption | undefined {
    // The reduce-cost option is the candy row whose label contains the
    // reduceCost i18n text ("Reduce Cost"); match loosely on "Reduce".
    return options.find(o => o.item === "candy" && /reduce/i.test(o.label));
  }

  it("reflects the new reduction tier after a reduce-cost purchase", async () => {
    // Give a starter we control. BULBASAUR base cost 3 has two distinct
    // reduction tiers, so the reduce-cost candy count and the resulting
    // new-cost both change between tier 0 and tier 1.
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);

    // Make the species fully caught so the candy menu opens.
    const dex = globalScene.gameData;
    const handler = await runToPokedexPage(species);

    const starterId = (handler as unknown as { starterId: number }).starterId;
    // Caught with default attrs so isCaught()/isFormCaught() pass.
    dex.dexData[starterId].caughtAttr = species.getFullUnlocksData();
    dex.starterData[starterId].valueReduction = 0;
    dex.starterData[starterId].candyCount = 1000;

    // Free upgrades so the handler doesn't bail on affordability; we want to
    // verify the DISPLAY, and persistence is exercised via valueReduction.
    vi.spyOn(Overrides, "FREE_CANDY_UPGRADE_OVERRIDE", "get").mockReturnValue(true);
    // Avoid real save IO.
    vi.spyOn(dex, "saveSystem").mockResolvedValue(true);

    const spy = vi.spyOn(globalScene.ui, "setModeWithoutClear");

    // 1) Open the candy menu at reduction tier 0 and grab the reduce-cost label.
    const beforeOptions = openCandyMenu(handler, spy);
    const beforeReduce = findReduceCost(beforeOptions);
    expect(beforeReduce).toBeDefined();
    const labelTier0 = beforeReduce!.label;

    // 2) Buy the reduction (handler mutates valueReduction and refreshes the page).
    expect(dex.starterData[starterId].valueReduction).toBe(0);
    await beforeReduce!.handler();
    expect(dex.starterData[starterId].valueReduction).toBe(1);

    // 3) Reopen the candy menu — the reduce-cost label must now show tier 1.
    const afterOptions = openCandyMenu(handler, spy);
    const afterReduce = findReduceCost(afterOptions);
    expect(afterReduce).toBeDefined();
    const labelTier1 = afterReduce!.label;

    // The displayed reduce-cost label must change to reflect the new reduction.
    expect(labelTier1).not.toBe(labelTier0);
  });
});

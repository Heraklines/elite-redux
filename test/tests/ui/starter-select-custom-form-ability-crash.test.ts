/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux regression: black-screen crash when selecting certain
// ER-custom-form starters ("Floette Eternal Flower", "Mimikyu Busted") after
// importing a session.
//
// Root cause (StarterSelectUiHandler.setSpeciesDetails -> active-ability
// lookup, ~line 4826/4833):
//
//     if (this.lastSpecies.forms?.length > 1) {
//       ability = allAbilities[this.lastSpecies.forms[formIndex ?? 0].getAbility(...)];
//     } else {
//       ability = allAbilities[this.lastSpecies.getAbility(...)];
//     }
//     ...
//     this.pokemonAbilityText.setText(ability.name)
//
// Two unguarded failure modes, both reachable for these species:
//   1. `formIndex` >= forms.length -> `forms[formIndex]` is undefined ->
//      `.getAbility` throws. Floette Eternal Flower (an ER custom whose
//      injected mega makes forms.length === 2) and vanilla Mimikyu (Disguised
//      + Busted forms) both hit this when an imported/stale dexAttr carries a
//      formIndex beyond the form list.
//   2. The resolved AbilityId has no `allAbilities` entry -> `ability` is
//      undefined -> `ability.name` throws ("Cannot read properties of
//      undefined (reading 'name')" — the reported message).
//
// The fix clamps an out-of-range form lookup to the base species and falls
// back to AbilityId.NONE when the ability id has no registered entry, so the
// preview renders harmlessly instead of black-screening. This drives the REAL
// handler (headless BattleScene) and asserts setSpeciesDetails never throws
// across an imported-state matrix (form index / ability index / passive bits).
// =============================================================================

import { allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { DexAttr } from "#enums/dex-attr";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("UI - Starter select - ER custom-form crash regression", () => {
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

  function getHandler(): StarterSelectUiHandler {
    return game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
  }

  type HandlerInternals = {
    lastSpecies: PokemonSpecies;
    speciesStarterDexEntry: unknown;
    setSpeciesDetails(s: PokemonSpecies, options?: object, save?: boolean): void;
  };

  // Multi-form species reachable in starter select. Floette Eternal Flower is
  // the ER custom (mega injection -> forms.length 2); Mimikyu is the vanilla
  // species whose "Busted" form the report names.
  const CASES: { name: string; id: number }[] = [
    { name: "Floette Eternal Flower (ER custom)", id: ErSpeciesId.FLOETTE_ETERNAL_FLOWER },
    { name: "Mimikyu Busted (vanilla form)", id: SpeciesId.MIMIKYU },
    // Single-form ER custom — exercises the non-form-indexed branch (line 4828).
    { name: "Mimikyu Busted (ER custom)", id: ErSpeciesId.MIMIKYU_BUSTED },
  ];

  for (const { name, id } of CASES) {
    it(`setSpeciesDetails never crashes for ${name} across imported-state shapes`, () => {
      const handler = getHandler();
      const species = allSpecies.find(s => (s.speciesId as number) === id) as PokemonSpecies | undefined;
      expect(species, `${name} (${id}) must be registered`).toBeDefined();
      if (!species) {
        return;
      }

      const dexEntry = game.scene.gameData.dexData[id];
      const starterEntry = game.scene.gameData.starterData[id];
      expect(dexEntry, `dexData entry for ${name} (${id}) must exist`).toBeDefined();
      expect(starterEntry, `starterData entry for ${name} (${id}) must exist`).toBeDefined();

      // Enter the caughtAttr render branch (ability/passive/move names rendered).
      dexEntry.caughtAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
      dexEntry.seenAttr = dexEntry.caughtAttr;

      const internals = handler as unknown as HandlerInternals;
      const formCount = Math.max(1, species.forms?.length ?? 0);
      const errors: string[] = [];

      // Probe formIndex values up to (and past) the form list to cover the
      // out-of-range case an imported/stale dexAttr can produce.
      for (let formIndex = 0; formIndex < formCount + 2; formIndex++) {
        for (let abilityIndex = 0; abilityIndex < 3; abilityIndex++) {
          for (const passiveAttr of [0, 1, 3, 21, 63]) {
            starterEntry.abilityAttr = 1; // ABILITY_1 unlocked
            starterEntry.passiveAttr = passiveAttr;
            internals.lastSpecies = species;
            internals.speciesStarterDexEntry = dexEntry;
            try {
              internals.setSpeciesDetails(species, { formIndex, abilityIndex }, false);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              errors.push(`form=${formIndex} ability=${abilityIndex} passiveAttr=${passiveAttr}: ${msg}`);
            }
          }
        }
      }

      expect(errors, `${name} crashed for ${errors.length} option set(s): ${errors[0] ?? ""}`).toEqual([]);
    });
  }
});

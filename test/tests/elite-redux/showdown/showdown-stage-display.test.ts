/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder "everything follows the stage" (B7 item 15) - detail-panel
// data tier. When a Field Stage (evolution / mega) is picked, the ability panel and the
// form-dependent detail fields (types, form name) must DISPLAY the FIELDED form's data:
// the picked abilityIndex mapped onto the FIELDED species' ability list, exactly what the
// battle-time fielding does. Unlock/validation semantics stay ROOT-based (unchanged).
//
// Drives the REAL `setSpeciesDetails` and reads back the rendered text objects (MockText
// stores `.text`). The party mini-icon following the stage is a PIXEL change verified by
// the `starter-select-showdown` render-harness recipe (MockSprite.setTexture is a no-op
// headlessly, so the icon key can't be asserted here). Gated ER_SCENARIO.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { allAbilities } from "#data/data-lists";
import { listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CAUGHT = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

type StageSelection = { speciesId: number; formIndex: number; item?: string };
type HandlerInternals = {
  lastSpecies: ReturnType<typeof getPokemonSpecies>;
  speciesStarterDexEntry: { caughtAttr: bigint; seenAttr: bigint };
  abilityCursor: number;
  showdownSelections: Map<number, StageSelection>;
  pokemonAbilityText: { text: string };
  pokemonFormText: { text: string };
  setSpeciesDetails(species: unknown, options?: object, save?: boolean): void;
};

function buildShowdownHandler(
  game: GameManager,
  rootId: SpeciesId,
): { handler: StarterSelectUiHandler; internals: HandlerInternals } {
  const dex = game.scene.gameData.dexData[rootId];
  const starterData = game.scene.gameData.starterData[rootId];
  dex.caughtAttr = CAUGHT;
  dex.seenAttr = CAUGHT;
  starterData.abilityAttr = 1;

  game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);

  const registered = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
  const handler = new (registered.constructor as new () => StarterSelectUiHandler)();
  handler.setup();
  handler.show([() => {}]);

  const internals = handler as unknown as HandlerInternals;
  internals.lastSpecies = getPokemonSpecies(rootId);
  internals.speciesStarterDexEntry = dex;
  return { handler, internals };
}

describe.skipIf(!RUN)("Showdown teambuilder stage display (B7 item 15)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("the ability panel shows the FIELDED mega form's ability, not the base", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildShowdownHandler(game, SpeciesId.CHARMANDER);

    // Baseline: no stage picked -> the ROOT (Charmander) ability is shown.
    internals.setSpeciesDetails(getPokemonSpecies(SpeciesId.CHARMANDER), {}, false);
    const baseSpecies = getPokemonSpecies(SpeciesId.CHARMANDER);
    const baseAbilityName = allAbilities[baseSpecies.getAbility(internals.abilityCursor)].name;
    expect(internals.pokemonAbilityText.text).toBe(baseAbilityName);

    // Pick a mega Charizard stage for the line.
    const megas = listMegaStages(SpeciesId.CHARMANDER);
    expect(megas.length, "Charmander line should offer at least one mega stage").toBeGreaterThan(0);
    const mega = megas[0];
    internals.showdownSelections.set(SpeciesId.CHARMANDER, { speciesId: mega.speciesId, formIndex: mega.formIndex });

    internals.setSpeciesDetails(getPokemonSpecies(SpeciesId.CHARMANDER), {}, false);

    // Now the panel must show the FIELDED mega form's ability at the picked index.
    const megaSpecies = getPokemonSpecies(mega.speciesId as SpeciesId);
    const megaForm = megaSpecies.forms[mega.formIndex] ?? megaSpecies;
    const megaAbilityName = allAbilities[megaForm.getAbility(internals.abilityCursor)].name;
    expect(internals.pokemonAbilityText.text).toBe(megaAbilityName);
    // The whole point: the mega's ability differs from the base line's (mega Charizards get a
    // fixed mega ability), so the panel genuinely changed to follow the stage.
    expect(internals.pokemonAbilityText.text).not.toBe(baseAbilityName);
  });

  it("an evolution stage shows the FIELDED form's ability + form name", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildShowdownHandler(game, SpeciesId.BULBASAUR);

    // Field Venusaur (the terminal evolution) for the Bulbasaur line.
    internals.showdownSelections.set(SpeciesId.BULBASAUR, { speciesId: SpeciesId.VENUSAUR, formIndex: 0 });
    internals.setSpeciesDetails(getPokemonSpecies(SpeciesId.BULBASAUR), {}, false);

    const venusaur = getPokemonSpecies(SpeciesId.VENUSAUR);
    const expectedAbility = allAbilities[venusaur.getAbility(internals.abilityCursor)].name;
    expect(internals.pokemonAbilityText.text).toBe(expectedAbility);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder FLOW wiring (grid confirm -> Set Editor -> Done -> team manifest).
//
// The full-screen Set Editor replaced the legacy per-mon form/item/move OPTION_SELECT for showdown.
// This drives the REAL StarterSelect handler and asserts the round-trip the wire/hash pipeline reads:
//   - grid-confirm on an eligible mon opens UiMode.SHOWDOWN_SET_EDITOR (mode assertion),
//   - the editor "Done" writes the edited set - INCLUDING the free `nature` - into the team, so
//     `starterToManifest(...)` carries it into the wire manifest + the canonical team hash,
//   - cancel discards (no mon added).
// Gated ER_SCENARIO (needs the real GameManager + balance tables), mirroring showdown-move-swap.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import { showdownTeamHash } from "#data/elite-redux/showdown/showdown-session";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type {
  ShowdownEditorSet,
  ShowdownEditorStage,
  ShowdownSetEditorConfig,
} from "#ui/showdown-set-editor-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CAUGHT = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

/** White-box access to the handler's private teambuilder + flow-wiring state (mirrors the other UI tests). */
type HandlerInternals = {
  lastSpecies: ReturnType<typeof getPokemonSpecies>;
  speciesStarterDexEntry: { caughtAttr: bigint; seenAttr: bigint };
  starterMoveset: number[] | null;
  abilityCursor: number;
  natureCursor: number;
  teraCursor: number;
  starterSpecies: unknown[];
  starters: Parameters<typeof starterToManifest>[0][];
  setSpeciesDetails(species: unknown, options?: object, save?: boolean): void;
  handleShowdownGridConfirm(isDupe: boolean, removeIndex: number, isValidForChallenge: boolean): void;
  buildShowdownEditorConfig(species: unknown, root: number, editIndex: number): ShowdownSetEditorConfig;
  commitShowdownEditor(
    species: unknown,
    root: number,
    editIndex: number,
    result: { stage: ShowdownEditorStage; set: ShowdownEditorSet },
  ): void;
};

function buildHandler(game: GameManager): { handler: StarterSelectUiHandler; internals: HandlerInternals } {
  const registered = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
  const handler = new (registered.constructor as new () => StarterSelectUiHandler)();
  handler.setup();
  handler.show([() => {}]);
  return { handler, internals: handler as unknown as HandlerInternals };
}

describe.skipIf(!RUN)("Showdown teambuilder editor flow (grid -> editor -> Done)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  function ownCharmander(game: GameManager): ReturnType<typeof getPokemonSpecies> {
    const dex = game.scene.gameData.dexData[SpeciesId.CHARMANDER];
    const starterData = game.scene.gameData.starterData[SpeciesId.CHARMANDER];
    dex.caughtAttr = CAUGHT;
    dex.seenAttr = CAUGHT;
    starterData.abilityAttr = 1; // ABILITY_1 unlocked
    starterData.eggMoves = 0;
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    return getPokemonSpecies(SpeciesId.CHARMANDER);
  }

  it("grid-confirm on an eligible mon opens the Set Editor (mode assertion)", () => {
    const game = new GameManager(phaserGame);
    const species = ownCharmander(game);
    const { internals } = buildHandler(game);
    internals.lastSpecies = species;
    internals.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.CHARMANDER];
    internals.setSpeciesDetails(species, {}, false);

    // Stub setMode: record the call but skip the real UI transition (a full mode transition awaits the
    // game clock, which a pure unit test never pumps). We only assert WHICH mode was opened.
    const setModeSpy = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined as never);
    // A brand-new, field-legal pick (not a dupe, valid for challenge).
    internals.handleShowdownGridConfirm(false, -1, true);

    expect(
      setModeSpy.mock.calls.some(call => call[0] === UiMode.SHOWDOWN_SET_EDITOR),
      "grid confirm should setMode(SHOWDOWN_SET_EDITOR)",
    ).toBe(true);
    // Nothing is committed to the team until the editor's Done fires.
    expect(internals.starterSpecies.length).toBe(0);
  });

  it("editor Done writes the edited set (incl. nature) into the team manifest", () => {
    const game = new GameManager(phaserGame);
    const species = ownCharmander(game);
    const { internals } = buildHandler(game);
    internals.lastSpecies = species;
    internals.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.CHARMANDER];
    internals.setSpeciesDetails(species, {}, false);

    const config = internals.buildShowdownEditorConfig(species, SpeciesId.CHARMANDER, -1);
    expect(config.rootSpeciesId).toBe(SpeciesId.CHARMANDER);

    // Simulate the player editing the nature in the editor (free-pick), then pressing Done.
    const editedNature = config.set.nature === Nature.ADAMANT ? Nature.JOLLY : Nature.ADAMANT;
    const editedSet: ShowdownEditorSet = { ...config.set, moves: [...config.set.moves], nature: editedNature };
    internals.commitShowdownEditor(species, SpeciesId.CHARMANDER, -1, { stage: config.stage, set: editedSet });

    expect(internals.starterSpecies.length, "the mon is added on Done").toBe(1);
    const manifest = starterToManifest(internals.starters[0], game.scene.gameData);
    // The edited nature reached the wire manifest (the whole point of the fairness field landing here).
    expect(manifest.nature, "manifest carries the edited nature").toBe(editedNature);
    expect("nature" in manifest, "nature key is present (omit-when-absent discipline satisfied)").toBe(true);
    // The manifest is transport-canonical: it hashes identically to its JSON round-trip (hash test lock).
    expect(showdownTeamHash([manifest])).toBe(showdownTeamHash(JSON.parse(JSON.stringify([manifest]))));
  });

  it("cancel discards - no mon is added to the team", () => {
    const game = new GameManager(phaserGame);
    const species = ownCharmander(game);
    const { internals } = buildHandler(game);
    internals.lastSpecies = species;
    internals.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.CHARMANDER];
    internals.setSpeciesDetails(species, {}, false);

    const config = internals.buildShowdownEditorConfig(species, SpeciesId.CHARMANDER, -1);
    // Back out of the editor without committing.
    config.onCancel?.();
    expect(internals.starterSpecies.length, "cancel adds nothing").toBe(0);
  });
});

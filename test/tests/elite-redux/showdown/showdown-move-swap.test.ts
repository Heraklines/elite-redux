/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder move-swap regression (B7 item 16 - live bug: "changing
// moves doesn't work at all").
//
// Root cause: item 3 widened the move-swap PICKER to the FIELDED stage's FULL legal
// learnset (level-up any level + TM/tutor + unlocked egg moves), but the detail-panel
// re-derivation in `setSpeciesDetails` still filtered the moveset against the vanilla
// early-move pool (`speciesStarterMoves` + egg moves). So the instant `switchMoveHandler`
// swapped in a full-learnset move (e.g. a TM move) and called `setSpeciesDetails`, that
// move was filtered right back out - the swap silently reverted and never reached the
// manifest.
//
// This drives the REAL handler: caught species -> setSpeciesDetails -> addToParty ->
// switchMoveHandler(slot, <full-learnset move NOT in the vanilla pool>, previous) and
// asserts the swapped move LANDS in `starterToManifest(...).moveset` (the exact wire the
// showdown launch reads). Gated ER_SCENARIO (needs the real GameManager + balance tables).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { collectShowdownLegalMoves, collectUnlockedEggMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
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

// White-box access to the handler's private teambuilder state (mirrors the other UI tests).
type HandlerInternals = {
  lastSpecies: ReturnType<typeof getPokemonSpecies>;
  speciesStarterDexEntry: { caughtAttr: bigint; seenAttr: bigint };
  speciesStarterMoves: number[];
  starterMoveset: number[] | null;
  dexAttrCursor: bigint;
  abilityCursor: number;
  natureCursor: number;
  teraCursor: number;
  starterSpecies: unknown[];
  starters: Parameters<typeof starterToManifest>[0][];
  setSpeciesDetails(species: unknown, options?: object, save?: boolean): void;
  addToParty(
    species: unknown,
    dexAttr: bigint,
    abilityIndex: number,
    nature: number,
    moveset: number[],
    teraType: number,
    randomSelection?: boolean,
  ): boolean;
  switchMoveHandler(targetIndex: number, newMove: number, previousMove: number): void;
};

describe.skipIf(!RUN)("Showdown teambuilder move swap (B7 item 16)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("a move swapped in from the full learnset lands in the manifest moveset", () => {
    const game = new GameManager(phaserGame);
    const CHARMANDER = SpeciesId.CHARMANDER;

    // Own the line so the detail panel enters the caughtAttr branch.
    const dex = game.scene.gameData.dexData[CHARMANDER];
    const starterData = game.scene.gameData.starterData[CHARMANDER];
    dex.caughtAttr = CAUGHT;
    dex.seenAttr = CAUGHT;
    starterData.abilityAttr = 1; // ABILITY_1 unlocked
    starterData.eggMoves = 0; // keep the test independent of egg-move unlocks

    // Force showdown mode BEFORE building the screen so the full-learnset picker path runs.
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);

    const registered = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    const handler = new (registered.constructor as new () => StarterSelectUiHandler)();
    handler.setup();
    handler.show([() => {}]);

    const species = getPokemonSpecies(CHARMANDER);
    const internals = handler as unknown as HandlerInternals;
    internals.lastSpecies = species;
    internals.speciesStarterDexEntry = dex;
    internals.setSpeciesDetails(species, {}, false);

    const initialMoveset = internals.starterMoveset?.slice() ?? [];
    expect(initialMoveset.length).toBeGreaterThan(0);

    const added = internals.addToParty(
      species,
      internals.dexAttrCursor,
      internals.abilityCursor,
      internals.natureCursor,
      initialMoveset.slice(),
      internals.teraCursor,
    );
    expect(added, "Charmander should be a legal showdown pick").toBe(true);
    expect(internals.starterSpecies.length).toBe(1);

    // A move that is in the FULL legal learnset (what the picker offers) but NOT in the vanilla
    // early-move pool nor the current moveset - exactly the class of move the old filter dropped.
    const fullPool = collectShowdownLegalMoves(CHARMANDER, CHARMANDER, collectUnlockedEggMoves(CHARMANDER, 0));
    const vanillaPool = new Set(internals.speciesStarterMoves);
    const currentSet = new Set(initialMoveset);
    const swapIn = [...fullPool].find(m => !vanillaPool.has(m) && !currentSet.has(m));
    expect(swapIn, "expected a full-learnset move outside the vanilla starter pool").toBeDefined();

    // Perform the swap the picker performs: replace slot 0.
    internals.switchMoveHandler(0, swapIn as number, initialMoveset[0]);

    // The swapped move must survive the re-derivation and reach the wire manifest.
    expect(internals.starters[0].moveset, "starter.moveset keeps the swapped move").toContain(swapIn);
    const manifest = starterToManifest(internals.starters[0], game.scene.gameData);
    expect(manifest.moveset, "manifest.moveset keeps the swapped move").toContain(swapIn);
  });
});

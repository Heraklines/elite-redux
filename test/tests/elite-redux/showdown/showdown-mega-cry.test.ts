/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: a vanilla-species mega built straight INTO its mega form at battle
// build (the Showdown teambuilder fields a picked mega STAGE via
// addPlayerPokemon(formIndex), NOT a mid-run form change) rendered mute — it
// logged `cry/445-mega not found` and played no cry.
//
// Root cause: ER redirects every mega form's SPRITE to its `elite-redux/{slug}`
// art (installErFormSpriteRedirect) and forces the base loadAssets `spriteOnly`,
// which also skips the CRY. But the cry still resolves through the vanilla
// `getCryKey` scheme (`cry/445-mega`) and that audio EXISTS for a vanilla-species
// mega, so skipping it was wrong for this construction-time path. The fix
// re-queues the cry for real vanilla-base redirected forms.
//
// This test drives the REAL resolution + REAL redirected loadAssets:
//   - the battle SPRITE key/atlas resolve to the mega SLUG (not the base Garchomp),
//   - loadAssets() QUEUES the vanilla mega cry `cry/445-mega`,
//   - the ENGINE name is "Mega Garchomp", and Showdown's battle-info panel also
//     exposes that selected permanent form instead of disguising it as the base set.
//
// Red-proof: revert the redirect cry re-queue -> the `cry/445-mega` load
// assertion fails (the cry is never queued). Gated behind ER_SCENARIO=1.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// Garchomp's mega is a VANILLA-scheme mega: dex 445, formIndex 1, ER slug art
// `elite-redux/garchomp_mega/…`, vanilla cry `cry/445-mega` (the file exists).
const GARCHOMP_MEGA_FORM_INDEX = 1;
const MEGA_CRY_KEY = "cry/445-mega";

describe.skipIf(!RUN)("Showdown construction-time vanilla mega (sprite + cry)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("resolves the mega SLUG sprite (not the base Garchomp) at construction time", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // Build Garchomp straight into its mega form, exactly as the showdown teambuilder
    // fields a picked mega stage (addPlayerPokemon with the mega formIndex; no mid-run
    // form change).
    const mon = game.scene.addPlayerPokemon(
      getPokemonSpecies(SpeciesId.GARCHOMP),
      100,
      undefined,
      GARCHOMP_MEGA_FORM_INDEX,
    );

    // The battle sprite must resolve to the ER mega SLUG art, NOT the base Garchomp
    // (`pkmn__back__445` / `back/445`).
    expect(mon.getBattleSpriteKey(true)).toBe("pkmn__back__er__garchomp_mega");
    expect(mon.getBattleSpriteAtlasPath(true)).toBe("elite-redux/garchomp_mega/back");
    expect(mon.getBattleSpriteKey(false)).toBe("pkmn__er__garchomp_mega");
    expect(mon.getBattleSpriteAtlasPath(false)).toBe("elite-redux/garchomp_mega/front");

    mon.destroy();
  });

  it("loadAssets QUEUES the vanilla mega cry (cry/445-mega), so it is not mute", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const mon = game.scene.addPlayerPokemon(
      getPokemonSpecies(SpeciesId.GARCHOMP),
      100,
      undefined,
      GARCHOMP_MEGA_FORM_INDEX,
    );

    // The key the field will actually PLAY (species-level, vanilla scheme).
    expect(mon.species.getCryKey(GARCHOMP_MEGA_FORM_INDEX)).toBe(MEGA_CRY_KEY);

    // Drive the REAL redirected loadAssets and capture what it queues on the loader.
    const audioSpy = vi.spyOn(game.scene.load, "audio");
    await mon.loadAssets();

    const queuedMegaCry = audioSpy.mock.calls.some(([key]) => key === MEGA_CRY_KEY);
    expect(queuedMegaCry, `loadAssets should queue the mega cry ${MEGA_CRY_KEY}`).toBe(true);

    audioSpy.mockRestore();
    mon.destroy();
  });

  it("engine and Showdown battle-info names both identify Mega Garchomp", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const mon = game.scene.addPlayerPokemon(
      getPokemonSpecies(SpeciesId.GARCHOMP),
      100,
      undefined,
      GARCHOMP_MEGA_FORM_INDEX,
    );

    // The engine identity carries the full form name (send-out message / summary use this).
    expect(mon.name).toBe("Mega Garchomp");
    expect(mon.species.getName(GARCHOMP_MEGA_FORM_INDEX)).toBe("Mega Garchomp");

    // Solo retains upstream's compact base-species panel label.
    expect(mon.getNameToRender({ prependFormName: false })).toBe("Garchomp");

    // Showdown is different: the permanent form is part of the negotiated set identity.
    // Refresh after selecting the mode, as the mon was built in the classic headless shell.
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    await mon.updateInfo(true);
    expect((mon as unknown as { battleInfo: { name: string } }).battleInfo.name).toBe("Mega Garchomp");

    mon.destroy();
  });
});

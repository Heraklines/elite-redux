/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: ER-custom (Redux) player BACK sprites failed to load in combat,
// softlocking the battle. Root cause — `Pokemon.getBattleSpriteAtlasPath` derived
// the atlas PATH from the sprite-key id via a `__`→`/` replace. ER-custom species
// use different key vs path schemes (key `back__er__{slug}` but path
// `elite-redux/{slug}/back`), so the replace produced the bogus `back/er/{slug}`,
// which 404'd. The fix delegates to the species form's `getSpriteAtlasPath`
// override.
//
// This test builds a real PlayerPokemon for an ER-custom species and asserts the
// front/back battle atlas paths use the `elite-redux/{slug}/...` scheme, while a
// vanilla species keeps the legacy `…/{id}` + `back/{id}` paths (no regression).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER custom (Redux) battle sprite atlas paths", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("ER-custom player sprite resolves to elite-redux/{slug}/{front,back} (not back/er/{slug})", async () => {
    // A vanilla battle just to get a live scene; we then construct ER-custom mons.
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    const phantowl = allSpecies.find(s => (s.speciesId as number) === ErSpeciesId.PHANTOWL);
    expect(phantowl).toBeDefined();
    if (!phantowl) {
      return;
    }
    const mon = game.scene.addPlayerPokemon(phantowl, 50);

    // Front (back === false): the scheme the FRONT load already used correctly.
    const frontPath = mon.getBattleSpriteAtlasPath(false);
    expect(frontPath).toBe("elite-redux/phantowl/front");

    // Back (the bug): must be the elite-redux back asset, NOT `back/er/phantowl`.
    const backPath = mon.getBattleSpriteAtlasPath(true);
    expect(backPath).toBe("elite-redux/phantowl/back");
    expect(backPath.startsWith("back/er/")).toBe(false);

    // The atlas KEY scheme is unchanged (key vs path intentionally differ).
    expect(mon.getBattleSpriteKey(true)).toBe("pkmn__back__er__phantowl");

    mon.destroy();
  });

  it("vanilla species battle sprite paths are unchanged (no regression)", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const mon = game.field.getPlayerPokemon();
    // Vanilla Magikarp (129): front `129`, back `back/129`.
    expect(mon.getBattleSpriteAtlasPath(false)).toBe(`${SpeciesId.MAGIKARP}`);
    expect(mon.getBattleSpriteAtlasPath(true)).toBe(`back/${SpeciesId.MAGIKARP}`);
  });
});

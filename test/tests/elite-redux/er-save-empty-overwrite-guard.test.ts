/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Guardrail (c) - the "I lost all my data" clobber vector.
//
// A 401 / auth-reset makes BattleScene.reset install a fresh, EMPTY `new GameData()`
// (systemDataLoaded = false) before the re-login re-loads real data. A stray
// saveSystem() in that window used to write the empty in-memory state straight over
// the good `data_<user>` localStorage blob - the player's dex/starters/unlocks gone.
//
// saveSystem() now REFUSES to overwrite EXISTING non-empty local data with a
// never-loaded (empty) GameData: it preserves the bytes, surfaces the failure, and
// returns false. A genuine brand-new account (no existing local blob) still saves.
// Gated behind ER_SCENARIO=1 (needs the real booted scene).
// =============================================================================

import { loggedInUser } from "#app/account";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER save-integrity: empty-over-existing local overwrite guard (c)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(5)
      .startingLevel(5)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REFUSES to overwrite existing local data with a never-loaded (empty) GameData", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const localKey = `data_${loggedInUser?.username}`;

    // Simulate the post-reset state: a fresh, never-loaded GameData is the live one.
    const freshEmpty = new GameData();
    game.scene.gameData = freshEmpty;

    // Existing good local data is on disk.
    const sentinel = "PRESERVE-ME-good-local-save-bytes";
    localStorage.setItem(localKey, sentinel);
    const setSpy = vi.spyOn(localStorage, "setItem");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await freshEmpty.saveSystem();

    expect(ok).toBe(false);
    // The good bytes are UNTOUCHED - no write to the system-save key.
    expect(localStorage.getItem(localKey)).toBe(sentinel);
    expect(setSpy).not.toHaveBeenCalledWith(localKey, expect.anything());
  });

  it("ALLOWS the first save of a brand-new account (no existing local blob)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const localKey = `data_${loggedInUser?.username}`;

    const freshEmpty = new GameData();
    game.scene.gameData = freshEmpty;

    // Brand-new account: nothing on disk yet.
    localStorage.removeItem(localKey);
    const setSpy = vi.spyOn(localStorage, "setItem");

    const ok = await freshEmpty.saveSystem();

    // First save lands (bypassLogin guest path returns the local-write result).
    expect(ok).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(localKey, expect.anything());
    expect(localStorage.getItem(localKey)).not.toBeNull();
  });
});

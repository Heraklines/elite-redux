/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #389 - Save and Quit force-pushes the full save to the cloud. The push
// itself shipped with the durable save system (#229): the menu handler calls
// saveAll(..., forceSync=true), which bypasses BOTH the sync throttle and the
// failure backoff (saveAll: `forceSync || shouldAttemptCloudSync()`). What was
// missing is FEEDBACK: a failed push quit silently and players believed the
// save was in the cloud. saveAll now maintains `lastCloudSyncFailed`, and the
// Save and Quit flow shows a warning before quitting when it is set. The full
// network failure path needs a live server (covered by the in-game scenario
// note); this pins the signal's reset semantics, which the warning relies on
// to never fire stale. Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokerogueApi } from "#api/api";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Save and Quit cloud push signal (#389)", () => {
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

  it("saveAll clears a stale failure signal on every attempt (the warning never fires stale)", async () => {
    // The test build compiles with VITE_BYPASS_LOGIN=1, so the actual network
    // push branch is compile-time disabled here - the failure assignment
    // itself sits directly beside markCloudSyncFailure() in saveAll and is
    // covered by the in-game scenario. What this CAN and must pin: the signal
    // RESETS at the top of every saveAll, so a warning never fires for an old
    // failure.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const gameData = game.scene.gameData;
    expect(gameData.lastCloudSyncFailed).toBe(false);

    // GameManager's ReloadHelper stubs saveAll out unconditionally - restore
    // the REAL implementation, it is the unit under test here.
    vi.mocked(gameData.saveAll).mockRestore();

    gameData.lastCloudSyncFailed = true;
    const ok = await gameData.saveAll(true, true, false, false, true);
    expect(ok).toBe(true);
    expect(gameData.lastCloudSyncFailed).toBe(false);

    // The API client used by the push exists with the expected method (the
    // worker serves POST /savedata/updateall for it).
    expect(typeof pokerogueApi.savedata.updateAll).toBe("function");
  });
});

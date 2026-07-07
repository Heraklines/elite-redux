/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op wiring-audit REVIEW item: the ER Dex Nav species picker is owner-gated.
//
// The Dex Nav consumable (ErDexNavModifier) registers ErDexNavPhase.PICK_COUNT species in the player's
// PER-ACCOUNT pokedex via an OPTION_SELECT picker (er-dex-nav-phase.ts). In a co-op reward shop the
// alternating OWNER picks the reward, but the WATCHER applies the SAME consumable to keep the shop in
// lockstep - so pre-fix BOTH clients unshifted ErDexNavPhase and BOTH opened the (drivable) picker,
// giving the watcher an unexpected screen AND free dex entries from the owner's item. The dex is
// per-account (NOT run-checksummed), so no relay/adopt is needed: the item USER (the reward owner)
// drives the picker and the watcher simply SKIPS it (er-dex-nav-phase.ts threads the shop's watcher
// flag, mirroring the ER ability-picker owner-gate).
//
// This is a fails-before/passes-after guard: pre-fix ErDexNavPhase had no watcher flag and always
// read the pool + opened the picker; now a watcher-constructed phase ends WITHOUT touching the picker.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every co-op engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-dexnav-owner-gate.test.ts
// =============================================================================

import { globalScene } from "#app/global-scene";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { ErDexNavPhase } from "#phases/er-dex-nav-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op Dex Nav owner-gate (wiring audit)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).startingWave(5);
    // A live battle gives us a real arena (the picker reads its wild pool) + a real ui.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
  });

  afterAll(() => {
    // best-effort
  });

  it("WATCHER: ErDexNavPhase SKIPS the picker - it ends without reading the dex pool or opening a screen", () => {
    const phase = new ErDexNavPhase(/* coopIsWatcher */ true);
    // Stub end() so calling it out-of-queue doesn't shift the real phase queue.
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
    const poolSpy = vi.spyOn(globalScene.arena, "getErDexNavSpeciesPool");
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");

    phase.start();

    // The watcher ended immediately, never read the dex pool, and never opened the species OPTION_SELECT.
    expect(endSpy, "watcher ends the phase immediately").toHaveBeenCalled();
    expect(poolSpy, "watcher never reads the dex pool (picker skipped)").not.toHaveBeenCalled();
    expect(
      setModeSpy.mock.calls.some(([mode]) => mode === UiMode.OPTION_SELECT),
      "watcher never opens the species OPTION_SELECT picker",
    ).toBe(false);
  });

  it("OWNER (default / solo): ErDexNavPhase opens the picker - it reads the dex pool", () => {
    const phase = new ErDexNavPhase(/* coopIsWatcher */ false);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    // Deterministic non-empty pool so the owner path proceeds into the picker.
    const poolSpy = vi
      .spyOn(globalScene.arena, "getErDexNavSpeciesPool")
      .mockReturnValue([SpeciesId.PIDGEY, SpeciesId.RATTATA]);

    phase.start();

    // The owner (the item USER) drives the picker: it reads the pool to build the species options.
    expect(poolSpy, "owner reads the dex pool to open the picker").toHaveBeenCalled();
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Guardrails (b) + (d) - SOLO save-slot robustness (regression locks).
//
// (b) NO slot -1 load: `getSession(slotId < 0)` returns undefined WITHOUT touching
//     localStorage, and `getSessionDataLocalStorageKey` throws on a negative slot
//     (defense-in-depth). The report's "Attempted to load save slot of -1" is a
//     WARN emitted by the load-game menu guard, not an actual load.
//
// (d) PER-SLOT ISOLATION: a malformed blob on ONE solo slot must not abort loading
//     the others. `getSession` surfaces the corruption as a classified, CATCHABLE
//     SaveDecodeError, which the enumeration's per-slot loader (SessionSlot.load has
//     its own .catch) flags on THAT slot alone - the sibling slots' independent
//     load promises are unaffected. This locks the "catchable + classified" contract
//     the per-slot isolation relies on.
// Gated behind ER_SCENARIO=1 (needs the real booted scene).
// =============================================================================

import { getSessionDataLocalStorageKey } from "#app/account";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { SaveDecodeError } from "#utils/data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER save-slot robustness (guardrails b + d)", () => {
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

  it("(b) getSession(-1) resolves undefined and never reads localStorage", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const getSpy = vi.spyOn(localStorage, "getItem");

    await expect(game.scene.gameData.getSession(-1)).resolves.toBeUndefined();
    // The sentinel is short-circuited before any storage access.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("(b) getSessionDataLocalStorageKey throws on a negative slot (defense-in-depth)", () => {
    expect(() => getSessionDataLocalStorageKey(-1)).toThrow();
  });

  it("(d) a corrupt SOLO slot surfaces a classified, catchable SaveDecodeError (per-slot isolation)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const corruptSlot = 3;
    // A malformed blob on this ONE slot (not valid base64 -> the guest atob path throws).
    localStorage.setItem(getSessionDataLocalStorageKey(corruptSlot), "@@@not-a-valid-save-blob@@@");
    vi.spyOn(console, "error").mockImplementation(() => {});

    // The failure is classified (SaveDecodeError from the hardened decode boundary),
    // so the per-slot loader can catch + flag THIS slot without aborting the others.
    await expect(game.scene.gameData.getSession(corruptSlot)).rejects.toBeInstanceOf(SaveDecodeError);

    // An UNoccupied sibling slot is independent - it simply reports empty (undefined).
    const emptySibling = 4;
    localStorage.removeItem(getSessionDataLocalStorageKey(emptySibling));
    await expect(game.scene.gameData.getSession(emptySibling)).resolves.toBeUndefined();
  });
});

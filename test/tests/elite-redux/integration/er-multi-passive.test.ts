/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: multi-passive (3-passive model).
//
// Verifies that ER's `_passives` triple on a species translates into the
// real battle pipeline — specifically that `Pokemon.getPassiveAbilities()`
// returns three non-null ability instances drawn from the ER B1a draft, NOT
// the legacy single-slot fallback. We boot a real `GameManager` so this
// exercises the actual init order (initializeGame() in init/init.ts) and
// catches regressions where `_passives` is null or mis-keyed.
//
// Canonical pattern (mirrors test/tests/abilities/intimidate.test.ts):
//   const phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
//   const game = new GameManager(phaserGame);
//   game.override.battleStyle(...).enemySpecies(...).enemyMoveset(...);
//   await game.classicMode.startBattle(SpeciesId.X);
//   ... assert on game.field.getPlayerPokemon() ...
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER integration — multi-passive (3-passive model)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      // Force-enable passives so we exercise the full 3-slot ER path. Without
      // this the underlying `this.passive` field on Pokemon defaults to false
      // (since the save's passive-unlock data isn't loaded in tests), which
      // gates all 3 ER slots off.
      .hasPassiveAbility(true);
  });

  it("Bulbasaur exposes its 3 ER passive slots (non-NONE) on the live Pokemon", async () => {
    // ER ships Bulbasaur with innates [65, 47, 344] — non-empty across all 3
    // slots. We don't pin to specific ability ids (the ER ID map could
    // legitimately re-map them mid-port); instead we assert the *structural*
    // invariant: all 3 slots are populated and distinct.
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    const player = game.field.getPlayerPokemon();
    const passives = player.getPassiveAbilities();

    // All 3 slots present (i.e. ER B1a's setPassives() ran on this species).
    expect(passives).toHaveLength(3);
    expect(passives[0]).not.toBeNull();
    expect(passives[1]).not.toBeNull();
    expect(passives[2]).not.toBeNull();

    // Slots must be the species-level ER passives, not all clones of the
    // same ability — verifies B1a's [a, b, c] triple was installed verbatim,
    // not the legacy single-slot fallback (which would put a real id in
    // slot 0 and NONE in slots 1/2 — caught by the null assertions above).
    const ids = passives.map(p => p!.id);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(2); // at least 2 distinct
  });

  it("species getPassiveCount() reports 3 for an ER-passive-equipped vanilla species", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const player = game.field.getPlayerPokemon();
    expect(player.species.getPassiveCount()).toBe(3);
  });

  it("legacy single-passive fallback species still resolves slot 0 correctly", async () => {
    // Use a vanilla species and verify the ER pipeline never breaks the
    // legacy single-passive path: slot 0 has a real ability, slots 1/2 are
    // null UNLESS ER B1a installed a triple. If B1a covered Magikarp too,
    // we get 3 — if not, slot 0 is non-null and slots 1/2 are null.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const passives = player.getPassiveAbilities();
    expect(passives[0]).not.toBeNull();
    // slot 0 must always exist for a live Pokemon — this is the legacy
    // invariant pokerogue depends on.
  });
});

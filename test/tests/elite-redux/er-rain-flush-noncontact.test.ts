/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: "Rain Flush" (ER move 5182) is a non-contact special water attack
// (its dex flag list has NO "Makes Contact"), so it must NOT trigger the
// opponent's Rough Skin / other contact-punish abilities.
//
// Root cause (same class as #254): `Move.setFlag(flag, false)` used XOR (a
// toggle), so the ER custom-move builder's `.makesContact(false)` on a SPECIAL
// move (whose MAKES_CONTACT bit was never set) wrongly TOGGLED contact ON.
// `setFlag` now clears with AND-NOT.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const RAIN_FLUSH = 5182 as MoveId;

describe.skipIf(!RUN)("ER Rain Flush is a non-contact move (#254 class)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Rain Flush lacks MAKES_CONTACT; TACKLE (a genuine contact move) keeps it", () => {
    void game;
    expect(allMoves[RAIN_FLUSH]?.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
    // Guard against over-correcting: a real physical contact move must stay contact.
    expect(allMoves[MoveId.TACKLE]?.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(true);
  });

  it("using Rain Flush on a Rough Skin holder does NOT proc Rough Skin", async () => {
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(100) // tanky enough to survive Rain Flush and take a real turn
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.ROUGH_SKIN)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([RAIN_FLUSH, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    game.textInterceptor.clearLogs();
    game.move.select(RAIN_FLUSH);
    await game.toEndOfTurn();

    // Rough Skin only punishes CONTACT and announces "... Rough Skin hurt its
    // attacker!". Rain Flush is non-contact, so that message must never appear.
    const log = game.textInterceptor.logs.join(" ").toLowerCase();
    expect(log).not.toContain("rough skin hurt");
  });
});

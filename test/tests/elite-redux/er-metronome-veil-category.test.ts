/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { resetErEndlessContinuation, restoreErEndlessContinuation } from "#data/elite-redux/er-endless-continuation";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Endless Metronome Veil move categories", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    resetErEndlessContinuation();
  });

  it("replaces status slots with status and damaging slots with damaging moves", async () => {
    restoreErEndlessContinuation({
      version: 1,
      enteredAtWave: 1,
      seed: "veil-category",
      pulse: 0,
      ghostEncounters: 0,
      activeRifts: [{ id: "metronome-veil", pulsesRemaining: 2, acquiredAtDepth: 0 }],
      ghostHistory: [],
    });
    const originals = [MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.EMBER, MoveId.PROTECT];
    const game = new GameManager(phaserGame);
    game.override
      .moveset(originals)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);

    await game.classicMode.startBattle(SpeciesId.EEVEE);

    const replacements = game.scene
      .getPlayerField()[0]
      .getMoveset()
      .map(move => move.getMove());
    expect(replacements).toHaveLength(originals.length);
    replacements.forEach((move, index) => {
      expect(move.category === MoveCategory.STATUS).toBe(allMoves[originals[index]].category === MoveCategory.STATUS);
      expect(move.pp).toBeGreaterThan(0);
    });
  });
});

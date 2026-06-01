/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// North Wind (ER 348): "3 turns Aurora Veil on entry." The screen must protect
// only the HOLDER's side — the EntryEffect default of ArenaTagSide.BOTH put it
// on the enemy's side too. Gated behind ER_SCENARIO=1.
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER North Wind (348) — Aurora Veil only on the holder's side", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(ER_ID_MAP.abilities[348] as AbilityId); // North Wind on the player
  });

  it("sets Aurora Veil on the PLAYER side and NOT the enemy side", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const arena = game.scene.arena;
    expect(arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)).toBeDefined();
    expect(arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.ENEMY)).toBeUndefined();
  });
});

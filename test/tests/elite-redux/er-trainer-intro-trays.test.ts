/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// When a healthy player Pokemon persists from a wild wave into a trainer wave,
// no player SummonPhase runs. The enemy trainer's send-out must therefore close
// both party trays or the player's tray remains over the battle UI indefinitely.

import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { SummonPhase } from "#phases/summon-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("trainer intro party-tray cleanup", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.YOUNGSTER })
      .battleStyle("single")
      .moveset([MoveId.TACKLE, MoveId.WATER_GUN, MoveId.PROTECT, MoveId.REST])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.RUN_AWAY)
      .enemyMoveset(MoveId.TACKLE);
  });

  it("enemy trainer send-out closes both the enemy and persisted-player trays", async () => {
    await game.classicMode.startBattle(SpeciesId.MUDKIP);

    const playerHide = vi.spyOn(game.scene.pbTray, "hide").mockResolvedValue();
    const enemyHide = vi.spyOn(game.scene.pbTrayEnemy, "hide").mockResolvedValue();
    game.scene.pbTray.shown = true;
    game.scene.pbTrayEnemy.shown = true;

    new SummonPhase(0, false).preSummon();

    expect(enemyHide).toHaveBeenCalledOnce();
    expect(playerHide).toHaveBeenCalledOnce();
  });
});

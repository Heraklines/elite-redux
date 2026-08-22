/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("enemy AI consecutive switch cooldown", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("single")
      .criticalHits(false)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  it("uses the normal move and target calculation after the single-battle switch cap", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const battle = globalScene.currentBattle;
    const enemy = globalScene.getEnemyField()[0];
    const chosenMove = { move: MoveId.SPLASH, targets: [0], useMode: MoveUseMode.NORMAL };
    const nextMove = vi.spyOn(enemy, "getNextMove").mockReturnValue(chosenMove);
    const scoreBench = vi.spyOn(battle.trainer!, "getPartyMemberMatchupScores");
    battle.enemySwitchCounter = 1;

    const phase = new EnemyCommandPhase(0) as unknown as {
      end(): void;
      resolveEnemyAiCommandWithCachedAbilities(): void;
    };
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.resolveEnemyAiCommandWithCachedAbilities();

    expect(scoreBench).not.toHaveBeenCalled();
    expect(nextMove).toHaveBeenCalledOnce();
    expect(battle.turnCommands[battle.arrangement.enemyOffset]).toMatchObject({
      command: Command.FIGHT,
      move: chosenMove,
    });
    expect(battle.enemySwitchCounter).toBe(0);
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Repro + regression for ER bug report: "the move does not seem to lower the
// user's defenses." Exact move ambiguous (screenshot shows V-create).
//
// CONCLUSION: V-create's self-stat drop (DEF/SPDEF/SPD -1, selfTarget) is NOT
// broken. When the move CONNECTS, all three drops apply correctly. The apparent
// "no drop" is V-create's 95% accuracy: a real miss applies no effects (correct
// game behavior). Superpower (ATK/DEF) and Close Combat (DEF/SPDEF) likewise
// work. These tests force the hit and assert the drops to lock the behavior in.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { StatStageChangeAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER self-defense-drop repro", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function runMove(move: MoveId) {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(80)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.RAYQUAZA]);
    const player = game.field.getPlayerPokemon();
    game.move.use(move);
    await game.move.forceHit();
    await game.toEndOfTurn();
    return player;
  }

  it("V-create carries a correct selfTarget DEF/SPDEF/SPD -1 attr at runtime", () => {
    const m = allMoves[MoveId.V_CREATE];
    const dropAttr = m.attrs.find(a => a.is("StatStageChangeAttr")) as StatStageChangeAttr | undefined;
    expect(dropAttr, "V-create has a StatStageChangeAttr").toBeDefined();
    expect(dropAttr?.selfTarget, "drop targets the user").toBe(true);
    expect(dropAttr?.stages, "drop is -1 stage").toBe(-1);
    expect(dropAttr?.stats, "drop lowers DEF/SPDEF/SPD").toEqual([Stat.DEF, Stat.SPDEF, Stat.SPD]);
    // 95% accuracy is canon and explains the field report (a miss applies no effects).
    expect(m.accuracy, "V-create is 95% accurate (misses are expected)").toBe(95);
  });

  it("V-create lowers user DEF/SPDEF/SPD by 1", async () => {
    const player = await runMove(MoveId.V_CREATE);
    expect(player.getStatStage(Stat.DEF), "DEF -1").toBe(-1);
    expect(player.getStatStage(Stat.SPDEF), "SPDEF -1").toBe(-1);
    expect(player.getStatStage(Stat.SPD), "SPD -1").toBe(-1);
  });

  it("Superpower lowers user ATK/DEF by 1", async () => {
    const player = await runMove(MoveId.SUPERPOWER);
    expect(player.getStatStage(Stat.ATK), "ATK -1").toBe(-1);
    expect(player.getStatStage(Stat.DEF), "DEF -1").toBe(-1);
  });

  it("Close Combat lowers user DEF/SPDEF by 1", async () => {
    const player = await runMove(MoveId.CLOSE_COMBAT);
    expect(player.getStatStage(Stat.DEF), "DEF -1").toBe(-1);
    expect(player.getStatStage(Stat.SPDEF), "SPDEF -1").toBe(-1);
  });

  it("Dragon Ascent lowers user DEF/SPDEF by 1", async () => {
    const player = await runMove(MoveId.DRAGON_ASCENT);
    expect(player.getStatStage(Stat.DEF), "DEF -1").toBe(-1);
    expect(player.getStatStage(Stat.SPDEF), "SPDEF -1").toBe(-1);
  });

  it("Make It Rain lowers user SPATK by 1", async () => {
    const player = await runMove(MoveId.MAKE_IT_RAIN);
    expect(player.getStatStage(Stat.SPATK), "SPATK -1").toBe(-1);
  });
});

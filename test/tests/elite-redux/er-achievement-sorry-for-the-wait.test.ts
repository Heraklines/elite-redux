/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// SORRY FOR THE WAIT: "KO a boss with a first-turn charge move without skipping
// the charge turn." Tester report (2026-07-02): a genuine charge-turn Meteor
// Beam boss OHKO did not grant it. Root cause: the tracker recorded the charge
// only when `currentBattle.turn === 0`, but battle.turn is 1-based during play
// (TurnInitPhase increments before MoveChargePhase runs) - the gate could never
// pass, so the achievement was UNOBTAINABLE. Fixed to `=== 1`.
//
// Also pins the intended exclusions: an instant charge (Power Herb) must NOT
// record, and a charge that starts on a later turn must NOT record.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { ErCommunityItemModifier } from "#modifiers/modifier";
import { erCommunityItemModifierType } from "#modifiers/modifier-type";
import { achvs } from "#system/achv";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER achievement: Sorry For The Wait (first-turn charge move boss KO)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .ability(AbilityId.RUN_AWAY)
      .moveset([MoveId.METEOR_BEAM, MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyHealthSegments(2)
      .enemyAbility(AbilityId.RUN_AWAY)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
  });

  it("grants the achievement when a turn-1-charged Meteor Beam KOs the boss on turn 2", async () => {
    await game.classicMode.startBattle(SpeciesId.PROBOPASS);
    const boss = game.field.getEnemyPokemon();
    expect(boss.isBoss(), "enemy must be a boss for the trigger").toBe(true);

    game.move.select(MoveId.METEOR_BEAM);
    await game.phaseInterceptor.to("TurnEndPhase"); // turn 1: charge
    expect(boss.isFainted(), "boss must survive the charge turn").toBe(false);

    await game.phaseInterceptor.to("TurnEndPhase"); // turn 2: the beam lands
    expect(boss.isFainted(), "the level-5 boss dies to the turn-2 beam").toBe(true);
    expect(game.scene.gameData.achvUnlocks, "achievement unlocked").toHaveProperty(achvs.SORRY_FOR_THE_WAIT.id);
  });

  it("does NOT grant it when the charge starts after turn 1", async () => {
    await game.classicMode.startBattle(SpeciesId.PROBOPASS);
    const boss = game.field.getEnemyPokemon();

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase"); // turn 1: not charging

    game.move.select(MoveId.METEOR_BEAM);
    await game.phaseInterceptor.to("TurnEndPhase"); // turn 2: charge
    await game.phaseInterceptor.to("FaintPhase"); // turn 3: beam lands + KO (wave ends, no TurnEndPhase)

    expect(boss.isFainted(), "boss dies to the turn-3 beam").toBe(true);
    expect(game.scene.gameData.achvUnlocks, "no unlock for a later-turn charge").not.toHaveProperty(
      achvs.SORRY_FOR_THE_WAIT.id,
    );
  });

  it("does NOT grant it when Power Herb skips the charge turn", async () => {
    await game.classicMode.startBattle(SpeciesId.PROBOPASS);
    const boss = game.field.getEnemyPokemon();
    const herb = erCommunityItemModifierType("powerHerb").newModifier(
      game.field.getPlayerPokemon(),
    ) as ErCommunityItemModifier;
    globalScene.addModifier(herb, true);

    game.move.select(MoveId.METEOR_BEAM);
    await game.phaseInterceptor.to("TurnEndPhase"); // herb: charge + beam same turn

    expect(boss.isFainted(), "boss dies to the instant beam").toBe(true);
    expect(game.scene.gameData.achvUnlocks, "no unlock when the charge was skipped").not.toHaveProperty(
      achvs.SORRY_FOR_THE_WAIT.id,
    );
  });
});

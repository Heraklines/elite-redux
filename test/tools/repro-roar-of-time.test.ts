/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #604: Roar of Time + Temporal Rupture.
//
// ER 2.65 dex (authoritative):
//   - Roar of Time (base): "A blast which distorts even time. Forces the target
//     to switch. Moves last." -> 90 BP, priority -6, force-switch, NO recharge.
//   - Temporal Rupture (ability 830): "Roar of Time becomes a 100 BP +0 Priority
//     attack that changes the target's Ability to Slow Start ... but NO LONGER
//     forces the target to switch."
//
// Live report (Psiell) saw Temporal Rupture STILL force-switching, wasting the
// Slow Start on the leaving mon. Per the dex the fix is: under Temporal Rupture
// the move must NOT force-switch (the slow-started target stays in).
//
// A regular trainer battle gives the base force-switch a bench to pull from, so
// we observe the switch as a change of the active enemy's id. enemyLevel(100) vs
// startingLevel(5) keeps the hit non-lethal so the target switches (not faints);
// the enemy's move is HARDEN (a harmless self-buff) because ER's "Splash" is a
// 40-BP damaging move that would KO the level-5 user.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-roar-of-time.test.ts

import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: Roar of Time / Temporal Rupture (#604)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("BASE Roar of Time force-switches the target and the user does NOT recharge", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .battleType(BattleType.TRAINER)
      .startingWave(35)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.ROAR_OF_TIME])
      .startingLevel(5) // tiny so Roar of Time can't KO -> the target survives to switch
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.DIALGA);

    expect(game.scene.getEnemyParty().length, "trainer needs a bench to switch into").toBeGreaterThanOrEqual(2);
    const player = game.field.getPlayerPokemon();
    const beforeId = game.field.getEnemyPokemon().id;

    game.move.use(MoveId.ROAR_OF_TIME);
    await game.move.selectEnemyMove(MoveId.HARDEN);
    await game.toNextTurn();

    const afterId = game.field.getEnemyPokemon().id;
    console.log(`base: enemy ${beforeId} -> ${afterId} (switched=${beforeId !== afterId})`);
    expect(afterId, "base Roar of Time must force the target to switch out").not.toBe(beforeId);
    expect(player.getTag(BattlerTagType.RECHARGING), "base Roar of Time must NOT cause a recharge").toBeFalsy();
  }, 120_000);

  it("Temporal Rupture: NO force-switch, target stays in with Slow Start", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .battleType(BattleType.TRAINER)
      .startingWave(35)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(ErAbilityId.TEMPORAL_RUPTURE as unknown as AbilityId)
      .moveset([MoveId.ROAR_OF_TIME])
      .startingLevel(5)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.DIALGA);

    expect(game.scene.getEnemyParty().length).toBeGreaterThanOrEqual(2);
    const before = game.field.getEnemyPokemon();
    const beforeId = before.id;

    game.move.use(MoveId.ROAR_OF_TIME);
    await game.move.selectEnemyMove(MoveId.HARDEN);
    await game.toNextTurn();

    const after = game.field.getEnemyPokemon();
    console.log(
      `TR: enemy ${beforeId} -> ${after.id} (switched=${beforeId !== after.id}) ability="${after.getAbility()?.name}"`,
    );
    expect(after.id, "Temporal Rupture must NOT force the target to switch out").toBe(beforeId);
    expect(after.getAbility()?.id, "the staying target's ability must become Slow Start").toBe(AbilityId.SLOW_START);
  }, 120_000);
});

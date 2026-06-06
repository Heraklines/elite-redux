/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: "Devious Shot" (ER move id 816) applies Bleed but did NO
// damage-over-time tick, while "Blood Shot" (id 810) DOES. The ER_BLEED battler
// tag (ErBleedTag) ticks 1/16 max-HP at every turn-end until cured. This test
// puts Devious Shot to use in a real battle and asserts the target both gains
// the ER_BLEED tag AND takes the recurring chip damage on subsequent turn-ends,
// exactly like Blood Shot.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Devious Shot inflicts ticking ER_BLEED like Blood Shot", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(100) // tanky so the chip is observable without fainting
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Snorlax is Normal — not Rock/Ghost, so it is NOT immune to ER_BLEED.
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH);
  });

  test("the built move carries the ER_BLEED battler-tag attr", () => {
    const move = allMoves[ER_ID_MAP.moves[816]];
    expect(move).toBeDefined();
    const hasBleed = move.attrs.some(
      a =>
        a.constructor.name === "AddBattlerTagAttr"
        && (a as { tagType?: BattlerTagType }).tagType === BattlerTagType.ER_BLEED,
    );
    expect(hasBleed).toBe(true);
  });

  test("applies ER_BLEED to the target and chips it every turn-end", async () => {
    const deviousShot = ER_ID_MAP.moves[816] as MoveId;
    // Chansey: huge HP (survives the hit + several bleed ticks) and a known
    // bleed-eligible target (used by the crit-bleed suite). A low-level player
    // Snorlax keeps Devious Shot from one-shotting it, and Chansey's feeble
    // attack can't faint the player, so the bleed has turns to tick.
    game.override.moveset([deviousShot, MoveId.SPLASH]).enemySpecies(SpeciesId.CHANSEY).startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();

    // Pin the secondary-effect chance roll so the move's 50% bleed always procs.
    // The roll runs through BattleScene.prototype.randBattleSeedInt, so mock at
    // the prototype level (a player-instance spy misses the scene-level roll).
    const savedRng = BattleScene.prototype.randBattleSeedInt;
    BattleScene.prototype.randBattleSeedInt = (_range: number, min = 0) => min;

    try {
      game.move.select(deviousShot);
      await game.phaseInterceptor.to("TurnEndPhase");

      // The bleed tag landed and ticked once at this turn-end.
      expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
      const hpAfterFirstTick = enemy.hp;
      expect(hpAfterFirstTick).toBeLessThan(enemy.getMaxHp());

      // Pass another turn with Splash; the bleed must chip AGAIN at turn-end.
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
      expect(enemy.hp).toBeLessThan(hpAfterFirstTick);
    } finally {
      BattleScene.prototype.randBattleSeedInt = savedRng;
    }
  });
});

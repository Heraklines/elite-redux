/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format battles - LIVE-SCENE headless proof of the triple foundation.
//
// The pure arrangement math has unit coverage (test/data/battle-format.test.ts).
// THIS test boots a REAL GameManager battle and flips it to TRIPLE_FORMAT, then
// asserts the live engine's field plumbing responds to the format (NOT the
// hardcoded binary "2 per side"):
//   - getBattlerCount()/double reflect a 3-wide player side (and triple != double),
//   - getPlayerField slices to 3,
//   - getField() is 6 wide with the enemy side based at flat index 3 (shifted
//     from the legacy 2), and the enemy's getBattlerIndex() shifts 2 -> 3.
//
// This is the foundation working end-to-end in a live scene; the full auto-spawn
// pipeline (3x SummonPhase / CheckSwitch / turn loop) is the next phase. Gated
// ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { DOUBLE_FORMAT, SINGLE_FORMAT, TRIPLE_FORMAT } from "#data/battle-format";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER multi-format - the live battle responds to TRIPLE_FORMAT (foundation)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(20)
      .enemyLevel(20);
  });

  afterEach(() => {
    // Restore the binary format so the shared module-state scene doesn't leak a
    // triple field into the next ER file (isolate:false).
    globalScene.currentBattle?.setFormat(SINGLE_FORMAT);
  });

  it("a battle flipped to TRIPLE reports a 3-wide player side, and triple is not 'double'", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    const battle = globalScene.currentBattle;

    // Baseline: a normal single battle.
    expect(battle.getBattlerCount()).toBe(1);
    expect(battle.double).toBe(false);

    battle.setFormat(TRIPLE_FORMAT);
    expect(battle.getBattlerCount()).toBe(3); // local side capacity
    expect(battle.double).toBe(false); // a TRIPLE is NOT a legacy double
    expect(battle.format).toBe(TRIPLE_FORMAT);
    // The player party (3 mons) now all count as the on-field side.
    expect(globalScene.getPlayerField().length).toBe(3);

    // And a double still reports double===true / count 2 (no regression).
    battle.setFormat(DOUBLE_FORMAT);
    expect(battle.getBattlerCount()).toBe(2);
    expect(battle.double).toBe(true);
    expect(globalScene.getPlayerField().length).toBe(2);
  });

  it("getField widens to 6 and the enemy side bases at flat index 3 (shifted from the legacy 2)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    const battle = globalScene.currentBattle;
    const enemy = globalScene.getEnemyField()[0];
    expect(enemy).toBeDefined();

    // Single: legacy layout - enemy at flat index 2, field length 3.
    expect(enemy.getBattlerIndex()).toBe(BattlerIndex.ENEMY); // 2
    expect(globalScene.getField()[BattlerIndex.ENEMY]).toBe(enemy);

    battle.setFormat(TRIPLE_FORMAT);
    // Triple: the enemy side base shifts to 3, so the field is 6 wide and the same
    // enemy (still field-position 0 on its side) now reports flat index 3.
    expect(globalScene.getField().length).toBe(6);
    expect(battle.arrangement.enemyOffset).toBe(3);
    expect(enemy.getBattlerIndex()).toBe(3);
    expect(globalScene.getField()[3]).toBe(enemy);
    // The 3 gap-free player slots at 0..2 and the enemy at 3 - the rest are empty.
    expect(globalScene.getField()[0]).toBe(globalScene.getPlayerField()[0]);
  });
});

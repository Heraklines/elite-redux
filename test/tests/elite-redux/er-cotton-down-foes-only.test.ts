/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER Cotton Down: the 2.65 dex says "Lowers the Speed of all FOES by one stage
// when hit" - opponents only. PokeRogue's PostDefendStatStageChangeAbAttr
// `allOthers` path lowered the Speed of all NON-self mons, i.e. the ally too
// (player report: "Cotton Down should only affect the opponents but still slows
// the ally"). This doubles repro hits the Cotton Down holder and checks the
// ALLY is NOT slowed while the FOE still is.
//
// Gated behind ER_SCENARIO=1.

import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Cotton Down lowers FOES' Speed only, not the ally", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .ability(AbilityId.COTTON_DOWN)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX) // bulky lvl-100 foes survive so their -1 stage is readable
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("a foe hitting the holder lowers FOES' Speed (-1) but leaves the ally at 0", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const [holder, ally] = game.scene.getPlayerField();
    const [foe] = game.scene.getEnemyField();
    expect(ally.getStatStage(Stat.SPD)).toBe(0);

    // Foes act first so Cotton Down fires while everyone is still on the field;
    // the lead foe Tackles the Cotton Down HOLDER (triggering it once).
    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
    game.move.select(MoveId.TACKLE, 1, BattlerIndex.ENEMY_2);
    await game.move.forceEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
    await game.move.forceEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
    await game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.ENEMY_2, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2]);
    await game.toEndOfTurn();

    // ER dex: foes only. The ally must NOT be slowed; the foes that hit must be
    // (both foes Tackle the holder, so each Cotton Down proc slows the foes).
    expect(ally.getStatStage(Stat.SPD), "ally Speed must be untouched (foes-only)").toBe(0);
    expect(foe.getStatStage(Stat.SPD), "a foe that hit the holder is slowed").toBeLessThan(0);
    expect(holder.getStatStage(Stat.SPD), "the holder never lowers its own Speed").toBe(0);
  });
});

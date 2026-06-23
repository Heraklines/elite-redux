/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #614: live report - a wild DOUBLE battle "made me end my run" while a
// usable Klefki was still alive. Log: 2 active player mons, the enemy's spread
// move (Swift) hit both (24 + 204 dmg), ONE fainted, then GameOverPhase fired
// even though the 24-dmg mon survived.
//
// This sets up the exact shape: party of 2 (Klefki + a 1-HP Magikarp), both
// active in a wild double, no bench. The enemy spread move (Surf) faints the
// 1-HP Magikarp; Klefki (full HP, much higher level) survives. The faint-phase
// game-over check must NOT fire here - it should move the lone survivor to
// center (ToggleDoublePosition). A GameOverPhase here is the bug.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-doubles-false-gameover.test.ts

import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: doubles false game-over with a survivor (#614)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("a spread move that faints ONE of two active mons must NOT end the run (partner alive)", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset([MoveId.SURF]) // spread: hits both player mons
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(80) // player mons high level so Klefki survives the chip Surf
      .enemyLevel(15)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.KLEFKI, SpeciesId.MAGIKARP);

    const party = game.scene.getPlayerParty();
    const klefki = party.find(p => p.species.speciesId === SpeciesId.KLEFKI)!;
    const magikarp = party.find(p => p.species.speciesId === SpeciesId.MAGIKARP)!;
    expect(party.length, "party of exactly 2 (both active, no bench)").toBe(2);
    magikarp.hp = 1; // any spread chip faints it

    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER);
    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.move.selectEnemyMove(MoveId.SURF);
    await game.move.selectEnemyMove(MoveId.SURF);
    await game.toEndOfTurn();

    const log = game.phaseInterceptor.log;
    console.log(
      `#614: Klefki fainted=${klefki.isFainted()} hp=${klefki.hp}/${klefki.getMaxHp()}; Magikarp fainted=${magikarp.isFainted()}; GameOver=${log.includes("GameOverPhase")}`,
    );
    expect(magikarp.isFainted(), "the 1-HP Magikarp should have fainted").toBe(true);
    expect(klefki.isFainted(), "Klefki should have survived the chip Surf").toBe(false);
    expect(log.includes("GameOverPhase"), "the run must NOT end while Klefki is alive").toBe(false);
  }, 120_000);

  it("a DOUBLE-KO of both active mons must summon the benched mon, not end the run", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset([MoveId.SURF])
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(80)
      .enemyLevel(15)
      .criticalHits(false);
    // 3 mons: 2 frail leads (Magikarp x2) + Klefki on the bench.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP, SpeciesId.KLEFKI);

    const party = game.scene.getPlayerParty();
    const klefki = party.find(p => p.species.speciesId === SpeciesId.KLEFKI)!;
    const [lead1, lead2] = game.scene.getPlayerField();
    lead1.hp = 1;
    lead2.hp = 1; // both active faint to one spread Surf -> double KO

    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER);
    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.move.selectEnemyMove(MoveId.SURF);
    await game.move.selectEnemyMove(MoveId.SURF);
    await game.toEndOfTurn();

    const log = game.phaseInterceptor.log;
    console.log(
      `#614 double-KO: bench Klefki onField=${klefki.isOnField()} fainted=${klefki.isFainted()}; GameOver=${log.includes("GameOverPhase")}`,
    );
    expect(klefki.isFainted(), "the benched Klefki must still be alive").toBe(false);
    expect(log.includes("GameOverPhase"), "a double-KO with a benched mon must NOT end the run").toBe(false);
  }, 120_000);
});

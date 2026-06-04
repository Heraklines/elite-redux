/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER damage-roll-floor hook: Bad Luck (334) / Bad Omen (671) force attacks
// against the holder to roll MINIMUM damage (the 0.85 floor) instead of the
// random 0.85–1.0 spread. Verified behaviorally: with the ability on the
// defender, two identical hits (defender re-healed to full between them) deal
// IDENTICAL damage — the variance is gone. A control without the ability is
// not asserted (random rolls only *usually* differ). Gated behind ER_SCENARIO.
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER damage-roll-floor (Bad Luck / Bad Omen force min-roll)", () => {
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
      .enemySpecies(SpeciesId.CHANSEY) // huge HP, frail Def → clear, survivable damage
      // Bad Omen (671): forces foes to min-roll, WITHOUT Bad Luck's -5% accuracy
      // (which would cause confounding misses on the seeded RNG).
      .enemyAbility(ER_ID_MAP.abilities[671] as AbilityId)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  afterEach(() => {
    game.phaseInterceptor?.restoreOg?.();
  });

  it("two identical hits on a Bad Luck holder deal identical (min-roll) damage", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();

    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmg1 = enemy.getMaxHp() - enemy.hp;

    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmg2 = enemy.getMaxHp() - enemy.hp;

    expect(dmg1).toBeGreaterThan(0);
    // No damage variance → the two rolls are identical (both forced to 0.85).
    expect(dmg2).toBe(dmg1);
  });
});

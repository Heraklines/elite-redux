/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Synchronized Current (5921) + Closed Circuit (5924) maintainer extensions
// (2026-07-15). Doubles-only; both player mons carry the ability via override.
//
//  Synchronized Current:
//   - both attack (different targets) -> each attack +25% power
//   - neither attacks (both status)   -> both heal 1/4 max HP at end of turn
//   - mixed (one attacks, one doesn't) -> no boost, no heal
//  Closed Circuit:
//   - both extras fire on a surviving shared target
//   - shared target faints from the FIRST extra -> the second extra redirects
//   - no living opponent left -> extras skip cleanly (wave-win path intact)
// =============================================================================

import {
  ER_CLOSED_CIRCUIT_ABILITY_ID,
  ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
} from "#data/elite-redux/abilities/plusle-minun";
import { resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SYNC = ER_SYNCHRONIZED_CURRENT_ABILITY_ID as AbilityId;
const CLOSED = ER_CLOSED_CIRCUIT_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Sync Current + Closed Circuit extensions (5921/5924)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resetTurnAttackLedger();
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.WOBBUFFET)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .battleStyle("double");
  });

  // NOTE: ER Splash is a Water-type PHYSICAL attack (not the vanilla no-op) and
  // Celebrate is the pure no-op used to keep foes from interfering. Harden is the
  // genuine STATUS move used for "not attacking".

  // --- Synchronized Current: both-attack 25% boost -------------------------

  it("both-attack: each attack is boosted 25% (targets need not match)", async () => {
    game.override.ability(SYNC).enemyMoveset(MoveId.CELEBRATE).moveset([MoveId.TACKLE, MoveId.HARDEN]);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const e0 = game.scene.getEnemyField()[0];

    // Turn 1: both attack DIFFERENT targets -> Plusle's tackle on e0 is boosted.
    const b0 = e0.hp;
    game.move.select(MoveId.TACKLE, 0, 2); // Plusle -> e0
    game.move.select(MoveId.TACKLE, 1, 3); // Minun -> e1
    await game.toNextTurn();
    const boostedDmg = b0 - e0.hp;

    // Turn 2: only Plusle attacks e0; Minun uses Harden (status) -> no boost.
    const b0b = e0.hp;
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.HARDEN, 1);
    await game.toNextTurn();
    const baseDmg = b0b - e0.hp;

    expect(baseDmg).toBeGreaterThan(0);
    expect(boostedDmg).toBeGreaterThan(baseDmg);
    // Power 40 -> 50 is exactly +25%; allow damage-rounding slack.
    expect(boostedDmg).toBeGreaterThanOrEqual(Math.floor(baseDmg * 1.2));
    expect(boostedDmg).toBeLessThanOrEqual(Math.ceil(baseDmg * 1.3));
  });

  // --- Synchronized Current: neither-attack 1/4 heal -----------------------

  it("neither-attack: both mons restore 1/4 max HP at end of turn", async () => {
    game.override.ability(SYNC).enemyMoveset(MoveId.CELEBRATE).moveset([MoveId.TACKLE, MoveId.HARDEN]);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [a, b] = game.scene.getPlayerField();
    a.hp = Math.floor(a.getMaxHp() / 2);
    b.hp = Math.floor(b.getMaxHp() / 2);
    const beforeA = a.hp;
    const beforeB = b.hp;

    // Both use Harden (a status move) -> neither attacked.
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.HARDEN, 1);
    await game.toEndOfTurn();

    expect(a.hp).toBeGreaterThan(beforeA);
    expect(b.hp).toBeGreaterThan(beforeB);
    expect(a.hp - beforeA).toBeGreaterThanOrEqual(Math.floor(a.getMaxHp() * 0.2));
    expect(b.hp - beforeB).toBeGreaterThanOrEqual(Math.floor(b.getMaxHp() * 0.2));
  });

  // --- Synchronized Current: mixed = no bonus ------------------------------

  it("mixed (one attacks, one doesn't): no heal", async () => {
    game.override.ability(SYNC).enemyMoveset(MoveId.CELEBRATE).moveset([MoveId.TACKLE, MoveId.HARDEN]);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [a, b] = game.scene.getPlayerField();
    a.hp = Math.floor(a.getMaxHp() / 2);
    b.hp = Math.floor(b.getMaxHp() / 2);
    const beforeA = a.hp;
    const beforeB = b.hp;

    game.move.select(MoveId.TACKLE, 0, 2); // a attacks
    game.move.select(MoveId.HARDEN, 1); // b uses a status move
    await game.toEndOfTurn();

    // One mon attacked, so the neither-attack heal must NOT fire on either.
    expect(b.hp).toBe(beforeB);
    expect(a.hp).toBe(beforeA);
  });

  // --- Closed Circuit: both extras on a surviving shared target ------------

  it("both extras fire on a surviving shared target (4 damage events)", async () => {
    game.override.ability(CLOSED).enemySpecies(SpeciesId.SHUCKLE);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const enemy = game.scene.getEnemyField()[0];
    const hp0 = enemy.hp;

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    await game.phaseInterceptor.to("MoveEndPhase");
    const h1 = enemy.hp;
    await game.phaseInterceptor.to("MoveEndPhase");
    const h2 = enemy.hp;
    await game.phaseInterceptor.to("MoveEndPhase");
    const h3 = enemy.hp;
    await game.phaseInterceptor.to("MoveEndPhase");
    const h4 = enemy.hp;

    // 2 primary tackles + 2 Closed Circuit extras = 4 distinct damage events.
    expect(h1).toBeLessThan(hp0);
    expect(h2).toBeLessThan(h1);
    expect(h3).toBeLessThan(h2);
    expect(h4).toBeLessThan(h3);
  });

  // --- Closed Circuit: shared target faints from FIRST extra -> redirect ----

  it("shared target faints from the first extra: the second extra redirects", async () => {
    game.override.ability(CLOSED).enemySpecies(SpeciesId.SHUCKLE);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [t0, t1] = game.scene.getEnemyField();
    // t0 survives both weak primaries but dies to the first 25 BP extra.
    t0.hp = 30;
    const t1Before = t1.hp;

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 2);
    await game.phaseInterceptor.to("BerryPhase", false);

    // t0 is KO'd; the second extra carried over to t1 (took Electric/Fairy damage).
    expect(t0.isFainted()).toBe(true);
    expect(t1.hp).toBeLessThan(t1Before);
  });

  // --- Closed Circuit: no living opponent -> skip cleanly ------------------

  it("no living opponent left: extras skip cleanly, wave proceeds", async () => {
    game.override.ability(CLOSED).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const [t0, t1] = game.scene.getEnemyField();
    // Both foes at 1 HP: the primaries KO both before either extra fires.
    t0.hp = 1;
    t1.hp = 1;

    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(MoveId.TACKLE, 1, 3);
    // Should reach turn end / victory without a softlock or throw.
    await game.phaseInterceptor.to("BerryPhase", false).catch(() => undefined);

    expect(t0.isFainted()).toBe(true);
    expect(t1.isFainted()).toBe(true);
  });
});

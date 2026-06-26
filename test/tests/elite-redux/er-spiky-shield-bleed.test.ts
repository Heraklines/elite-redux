/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: ER Spiky Shield (move id 596). Per the ER 2.65 dex it must
// "protect the user and cause bleeding on contact" — i.e. Protect PLUS ER_BLEED
// on any attacker that makes CONTACT, NOT vanilla's 1/8 chip damage.
//
// This test drives a real battle: the player uses Spiky Shield and the enemy
// attacks into it. It asserts:
//   1. a CONTACT move (Tackle) into Spiky Shield -> the attacker gains ER_BLEED
//      and the user is protected (takes no damage).
//   2. a NON-CONTACT move (Water Gun) into Spiky Shield -> the user is still
//      protected, but the attacker does NOT bleed.
//   3. a ROCK-type attacker making contact is immune to ER_BLEED (still
//      protected, no bleed) — proving the existing ErBleedTag.canAdd immunity
//      is honored through Pokemon.addTag.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Spiky Shield inflicts ER_BLEED on contact (per the 2.65 dex)", () => {
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
      .startingLevel(80)
      .enemyLevel(80)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Blissey: huge HP so it survives any chip and never faints while we watch.
      .moveset([MoveId.SPIKY_SHIELD, MoveId.SPLASH]);
  });

  test("Spiky Shield still carries the Protect attribute", () => {
    const move = allMoves[MoveId.SPIKY_SHIELD];
    expect(move).toBeDefined();
    // `hasAttr` is the codebase's canonical, minifier-proof attr check
    // (see move.ts ProtectAttr.getCondition). Protect behavior must be intact.
    expect(move.hasAttr("ProtectAttr")).toBe(true);
  });

  test("a CONTACT move into Spiky Shield bleeds the attacker (and the user is protected)", async () => {
    // Snorlax: Normal type (NOT Rock/Ghost -> bleed-eligible) and bulky.
    game.override.enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const playerHpBefore = player.hp;

    game.move.select(MoveId.SPIKY_SHIELD);
    await game.phaseInterceptor.to("TurnEndPhase");

    // The attacker that made contact now bleeds.
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
    // The user blocked the move entirely (Protect behavior unchanged).
    expect(player.hp).toBe(playerHpBefore);
    // Vanilla's 1/8 contact chip is REPLACED: the only HP the attacker loses is
    // the ER_BLEED tick (1/16), so it lost strictly less than 1/8 of its max HP.
    expect(enemy.getMaxHp() - enemy.hp).toBeLessThan(enemy.getMaxHp() / 8);
    // ...and it did tick at least once (bleed is a real DoT, not a no-op).
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
  });

  test("a NON-CONTACT move into Spiky Shield does NOT bleed the attacker", async () => {
    // Water Gun is a special, non-contact move. Snorlax still bleed-eligible.
    game.override.enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.WATER_GUN);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const playerHpBefore = player.hp;

    game.move.select(MoveId.SPIKY_SHIELD);
    await game.phaseInterceptor.to("TurnEndPhase");

    // No contact -> no bleed, and the attacker is at full HP (no chip at all).
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(enemy.hp).toBe(enemy.getMaxHp());
    // Still protected from the (non-contact) move.
    expect(player.hp).toBe(playerHpBefore);
  });

  test("a ROCK-type contact attacker is immune to ER_BLEED (still protected)", async () => {
    // Golem: Rock/Ground -> immune to bleeding per ErBleedTag.canAdd. Double-Edge
    // is a contact move; if immunity were ignored it would bleed.
    game.override.enemySpecies(SpeciesId.GOLEM).enemyMoveset(MoveId.DOUBLE_EDGE);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const playerHpBefore = player.hp;

    game.move.select(MoveId.SPIKY_SHIELD);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Rock type is immune to ER_BLEED.
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(enemy.hp).toBe(enemy.getMaxHp());
    // Still protected.
    expect(player.hp).toBe(playerHpBefore);
  });
});

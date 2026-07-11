/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ghastly Echo (dex 848): "Deals damage and switches. Switch-in gets 50%
// boost for 1 turn. Sound-based." The damage + self force-switch + SOUND_BASED
// flag are on the move; this test covers the "empower the switch-in" half:
// after Ghastly Echo's user force-switches itself out, the Pokemon sent out in
// its place gets a one-turn +50% MOVE POWER battler tag (ER_EMPOWERED_SWITCH_IN),
// applied at SummonPhase.onEnd and consumed after its FIRST move.
//
// Asserts:
//   - the switched-in mon carries ER_EMPOWERED_SWITCH_IN on send-out;
//   - its FIRST move deals ~1.5x the damage of its SECOND (tag gone by move 2);
//   - the tag is removed after the first move;
//   - Take Flight (976, same switch-out group) does NOT empower its switch-in;
//   - a plain U-turn switch-in does NOT get the tag (no over-application).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Ghastly Echo — empower the switch-in (+50% move power, 1 move)", () => {
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
      .enemyLevel(100) // tanky so nothing faints across Ghastly Echo + two Swifts
      // Ghastly Echo is Ghost-type — a Normal-type enemy would be immune and the
      // move (and its self-switch) would fail. Bronzor is Steel/Psychic (not
      // immune) with huge defenses to survive both Swifts; its low BST keeps it
      // off the #419 swap ladder, and it has NO trapping innate (Wobbuffet's
      // Shadow Tag would block the forced self-switch). Wave 1 = wild single.
      .enemySpecies(SpeciesId.BRONZOR)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN); // self-status: enemy never damages our mons
  });

  test("the incoming replacement's first move is 1.5x, second move normal; tag consumed after move 1", async () => {
    const ghastlyEcho = ER_ID_MAP.moves[848] as MoveId;
    // Lead uses Ghastly Echo (self-switch); the bench mon is the empowered
    // switch-in and attacks with Swift (special, never-miss — no accuracy noise).
    game.override.moveset([ghastlyEcho, MoveId.SWIFT]);
    await game.classicMode.startBattle(SpeciesId.GASTLY, SpeciesId.PIKACHU);

    const enemy = game.field.getEnemyPokemon();
    const lead = game.field.getPlayerPokemon();

    // Pin the damage variance roll so move 1 vs move 2 differ ONLY by the tag.
    const savedRng = BattleScene.prototype.randBattleSeedInt;
    BattleScene.prototype.randBattleSeedInt = (_range: number, min = 0) => min;

    try {
      // --- Turn 1: lead Ghastly Echoes, force-switches itself out ---
      game.move.select(ghastlyEcho);
      game.doSelectPartyPokemon(1);
      await game.phaseInterceptor.to("TurnEndPhase");
      await game.toNextTurn();

      const empowered = game.field.getPlayerPokemon();
      // A different mon is now active (the switch actually happened).
      expect(empowered.id).not.toBe(lead.id);
      // The switch-in carries the one-turn empower tag on send-out.
      expect(empowered.getTag(BattlerTagType.ER_EMPOWERED_SWITCH_IN)).toBeDefined();

      // --- Turn 2: empowered mon's FIRST move (boosted) ---
      const hpBeforeBoosted = enemy.hp;
      game.move.select(MoveId.SWIFT);
      await game.phaseInterceptor.to("TurnEndPhase");
      const boostedDamage = hpBeforeBoosted - enemy.hp;
      // Tag is consumed after the first move (AFTER_MOVE lapse).
      expect(empowered.getTag(BattlerTagType.ER_EMPOWERED_SWITCH_IN)).toBeUndefined();
      await game.toNextTurn();

      // --- Turn 3: same mon, same move, NO boost ---
      const hpBeforeNormal = enemy.hp;
      game.move.select(MoveId.SWIFT);
      await game.phaseInterceptor.to("TurnEndPhase");
      const normalDamage = hpBeforeNormal - enemy.hp;

      expect(normalDamage).toBeGreaterThan(0);
      expect(boostedDamage).toBeGreaterThan(normalDamage);
      // +50% power ⇒ ~1.5x damage (integer rounding gives a tiny slack).
      const ratio = boostedDamage / normalDamage;
      expect(ratio).toBeGreaterThan(1.45);
      expect(ratio).toBeLessThan(1.55);
    } finally {
      BattleScene.prototype.randBattleSeedInt = savedRng;
    }
  });

  test("Take Flight (976) force-switch does NOT empower its switch-in", async () => {
    const takeFlight = ER_ID_MAP.moves[976] as MoveId;
    game.override.moveset([takeFlight, MoveId.SWIFT]);
    await game.classicMode.startBattle(SpeciesId.GASTLY, SpeciesId.PIKACHU);
    const lead = game.field.getPlayerPokemon();

    game.move.select(takeFlight);
    game.doSelectPartyPokemon(1);
    await game.phaseInterceptor.to("TurnEndPhase");
    await game.toNextTurn();

    const switchedIn = game.field.getPlayerPokemon();
    expect(switchedIn.id).not.toBe(lead.id); // the switch really happened
    // No empower tag — only Ghastly Echo arms the switch-in boost.
    expect(switchedIn.getTag(BattlerTagType.ER_EMPOWERED_SWITCH_IN)).toBeUndefined();
  });

  test("a plain U-turn switch-in does NOT get the empower tag (no over-application)", async () => {
    game.override.moveset([MoveId.U_TURN, MoveId.SWIFT]);
    await game.classicMode.startBattle(SpeciesId.GASTLY, SpeciesId.PIKACHU);
    const lead = game.field.getPlayerPokemon();

    game.move.select(MoveId.U_TURN);
    game.doSelectPartyPokemon(1);
    await game.phaseInterceptor.to("TurnEndPhase");
    await game.toNextTurn();

    const switchedIn = game.field.getPlayerPokemon();
    expect(switchedIn.id).not.toBe(lead.id); // the switch really happened
    expect(switchedIn.getTag(BattlerTagType.ER_EMPOWERED_SWITCH_IN)).toBeUndefined();
  });
});

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — behavioral tests for the four vanilla abilities whose ER riders
// were previously deferred as no-ops and are now wired with real primitives:
//
//   - ANTICIPATION  → dodge the FIRST super-effective hit each battle
//   - AIR_LOCK      → set Tailwind (own side) on entry
//   - VITAL_SPIRIT  → Fighting-type moves cure the holder's status
//   - FRISK         → disable the foe's held items for 2 turns on entry
//
// These run full battles through GameManager and assert the *effect*, not just
// the wiring — the user's standing rule is "no no-ops, no approximations".
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER ability riders — Anticipation / Air Lock / Vital Spirit / Frisk", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(100).enemyLevel(5);
  });

  describe("Anticipation — dodges the first super-effective hit", () => {
    beforeEach(() => {
      game.override
        .ability(AbilityId.ANTICIPATION)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.PIKACHU)
        .enemyMoveset([MoveId.THUNDERBOLT]); // Electric: super-effective on Water
    });

    test("first super-effective hit deals 0 damage and spends the charge", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP); // pure Water

      const player = game.field.getPlayerPokemon();
      expect(player.isFullHp()).toBe(true);
      expect(player.battleData.anticipationDodgeUsed).toBe(false);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      // Dodged: no damage taken, charge consumed.
      expect(player.isFullHp()).toBe(true);
      expect(player.battleData.anticipationDodgeUsed).toBe(true);
    });

    test("the SECOND super-effective hit is no longer dodged", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(player.isFullHp()).toBe(true); // first dodged

      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      // Second SE hit connects.
      expect(player.hp).toBeLessThan(player.getMaxHp());
    });
  });

  describe("Air Lock — sets Tailwind on entry", () => {
    test("Tailwind is active on the holder's side after switch-in", async () => {
      game.override
        .ability(AbilityId.AIR_LOCK)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.RAYQUAZA);

      const tailwind = game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(tailwind).toBeDefined();
    });
  });

  describe("Vital Spirit — Fighting moves cure the holder's status", () => {
    beforeEach(() => {
      game.override
        .ability(AbilityId.VITAL_SPIRIT)
        .statusEffect(StatusEffect.BURN)
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyMoveset([MoveId.SPLASH]);
    });

    test("using a Fighting-type move cures the burn", async () => {
      game.override.moveset([MoveId.BRICK_BREAK]);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);

      const player = game.field.getPlayerPokemon();
      expect(player.status?.effect).toBe(StatusEffect.BURN);

      game.move.select(MoveId.BRICK_BREAK);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
    });

    test("a non-Fighting move does NOT cure the burn", async () => {
      game.override.moveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);

      const player = game.field.getPlayerPokemon();
      expect(player.status?.effect).toBe(StatusEffect.BURN);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(player.status?.effect).toBe(StatusEffect.BURN);
    });
  });

  describe("Frisk — disables the foe's held items for 2 turns", () => {
    beforeEach(() => {
      game.override
        .ability(AbilityId.FRISK)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyMoveset([MoveId.SPLASH])
        .enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
    });

    test("the foe receives the ER_ITEM_DISABLED tag on entry", async () => {
      await game.classicMode.startBattle(SpeciesId.GRENINJA);
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getTag(BattlerTagType.ER_ITEM_DISABLED)).toBeDefined();
    });

    test("the foe's Leftovers does not heal while items are disabled", async () => {
      await game.classicMode.startBattle(SpeciesId.GRENINJA);
      const enemy = game.field.getEnemyPokemon();
      // Drop the foe below full HP so Leftovers would heal if it were working.
      enemy.hp = enemy.getMaxHp() - 100;
      const before = enemy.hp;

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      // Items disabled → no Leftovers heal this turn.
      expect(enemy.hp).toBe(before);
    });
  });
});
